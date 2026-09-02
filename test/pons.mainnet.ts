import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { formatEther, parseEther, type Address } from "viem";

import {
  buildApprove,
  buildBuy,
  buildSell,
  getPonsClient,
  getRecentLaunches,
  getTokenState,
  priceFromSqrtPriceX96,
  quoteBuy,
  quoteSell,
  type TokenState,
} from "../app/src/lib/pons/trade.js";

import {
  PONS_FACTORY,
  SWAP_ROUTER,
  WETH,
} from "../app/src/lib/pons/addresses.js";

/*
 * Integration tests for the Pons integration, run against Robinhood Chain
 * mainnet — read-only plus simulated execution. No transaction is ever sent
 * and no funds are required.
 *
 * WHY NOT A TESTNET, AND WHY NOT A FORK
 *
 * Testnet (chain 46630) is live but EMPTY for our purposes: the Pons factory,
 * the Uniswap V3 factory, SwapRouter02, QuoterV2 and WETH all return empty
 * code there. Only Multicall3 is deployed. A testnet run would exercise
 * nothing.
 *
 * Forking mainnet with Hardhat also fails: EDR's forking needs `eth_getProof`,
 * and the Robinhood RPC answers it with "missing trie node ... is not
 * available". The public node also prunes state after ~6,000-8,000 blocks
 * (~10-13 minutes at 100ms blocks), so it is not an archive node either.
 *
 * What DOES work is `eth_simulateV1`, which the node supports. It executes a
 * SEQUENCE of calls against real current state with state carried between
 * them, so a buy, an approve and a sell can be run end-to-end through the real
 * verified bytecode and real pool liquidity — the only thing missing versus a
 * signed transaction is the signature itself.
 *
 * These assert on invariants rather than fixed amounts, because they run
 * against live third-party state that moves.
 */

const client = getPonsClient();

/** Funded only inside the simulation; this key does not exist. */
const TRADER: Address = "0x1111111111111111111111111111111111111111";

const OVERRIDES = [{ address: TRADER, balance: parseEther("100") }];

describe("Pons on Robinhood Chain (mainnet, simulated)", () => {
  let token: Address;
  let state: TokenState;

  before(async () => {
    const launches = await getRecentLaunches({ client, limit: 10 });

    assert.ok(launches.length > 0, "expected recent Pons launches");

    for (const launch of launches) {
      const candidate = await getTokenState({
        client,
        token: launch.token,
        user: TRADER,
      }).catch(() => null);

      if (candidate && !candidate.graduated && candidate.priceEth > 0) {
        token = launch.token;
        state = candidate;
        break;
      }
    }

    assert.ok(token, "expected a live, non-graduated Pons token");

    console.log(
      `      using ${state.name} (${state.symbol}) @ ${state.priceEth.toExponential(3)} ETH, ` +
        `${(state.graduationProgress * 100).toFixed(1)}% to graduation`,
    );
  });

  describe("chain and deployment", () => {
    it("is connected to Robinhood Chain mainnet", async () => {
      assert.equal(await client.getChainId(), 4663);
    });

    it("has the Pons factory and Uniswap periphery deployed", async () => {
      for (const address of [PONS_FACTORY, SWAP_ROUTER, WETH]) {
        const code = await client.getCode({ address });

        assert.ok(code && code !== "0x", `${address} should have code`);
      }
    });
  });

  describe("read layer", () => {
    it("reads coherent token state", () => {
      assert.equal(state.decimals, 18);
      assert.ok(state.totalSupply > 0n);
      assert.ok(state.priceEth > 0);
      assert.ok(state.graduationThreshold > 0n);
      assert.ok(state.graduationProgress >= 0 && state.graduationProgress <= 1);
      assert.match(state.pool, /^0x[0-9a-fA-F]{40}$/);
    });

    it("derives price consistently with the pool's own reserves ratio", () => {
      // A token0 price and its token1 inverse must round-trip.
      const sqrt = 2n ** 96n * 2n; // price ratio of 4
      const asToken0 = priceFromSqrtPriceX96(sqrt, true);
      const asToken1 = priceFromSqrtPriceX96(sqrt, false);

      assert.ok(Math.abs(asToken0 - 4) < 1e-9, `expected 4, got ${asToken0}`);
      assert.ok(Math.abs(asToken1 - 0.25) < 1e-9, `expected 0.25, got ${asToken1}`);
    });

    it("returns zero price for an uninitialised pool", () => {
      assert.equal(priceFromSqrtPriceX96(0n, true), 0);
    });

    it("rejects an address that is not a Pons token", async () => {
      await assert.rejects(
        () => getTokenState({ client, token: WETH }),
        /not a Pons-launched token/,
      );
    });
  });

  describe("quoting", () => {
    it("quotes a buy and scales with input", async () => {
      const small = await quoteBuy(client, token, parseEther("0.01"));
      const large = await quoteBuy(client, token, parseEther("0.1"));

      assert.ok(small > 0n, "small buy should quote tokens");
      assert.ok(large > small, "a larger buy should return more tokens");

      // Price impact means 10x the ETH buys strictly less than 10x the tokens.
      assert.ok(large < small * 10n, "expected price impact on the larger buy");
    });

    it("round-trips a quote at roughly twice the pool fee", async () => {
      const spend = parseEther("0.01");
      const tokens = await quoteBuy(client, token, spend);
      const back = await quoteSell(client, token, tokens);

      assert.ok(back > 0n && back < spend, "round trip should lose value");

      const loss = 1 - Number(formatEther(back)) / Number(formatEther(spend));

      // Two 1% swaps plus price impact. Anything outside this band means the
      // fee tier or pool selection is wrong.
      assert.ok(
        loss > 0.015 && loss < 0.08,
        `round-trip loss ${(loss * 100).toFixed(2)}% outside expected band`,
      );
    });

    it("refuses a zero-value trade instead of sending a reverting tx", async () => {
      await assert.rejects(
        () => buildBuy({ client, token, user: TRADER, ethAmountWei: 0n }),
        /Enter an ETH amount/,
      );

      await assert.rejects(
        () => buildSell({ client, token, user: TRADER, tokenAmount: 0n }),
        /Enter a token amount/,
      );
    });
  });

  describe("execution (eth_simulateV1 against live state)", () => {
    it("buys tokens with native ETH", async () => {
      const spend = parseEther("0.05");
      const write = await buildBuy({
        client,
        token,
        user: TRADER,
        ethAmountWei: spend,
      });

      const { results } = await client.simulateCalls({
        account: TRADER,
        stateOverrides: OVERRIDES,
        calls: [
          {
            to: write.address,
            abi: write.abi,
            functionName: write.functionName,
            args: write.args,
            value: write.value,
          } as never,
          {
            to: token,
            abi: state.decimals ? PONS_BALANCE_ABI : PONS_BALANCE_ABI,
            functionName: "balanceOf",
            args: [TRADER],
          } as never,
        ],
      });

      assert.equal(results[0].status, "success", "buy call should succeed");

      const balance = results[1].result as bigint;

      assert.ok(balance > 0n, "trader should hold tokens after the buy");

      console.log(
        `      bought ${Number(formatEther(balance)).toLocaleString()} ${state.symbol} for 0.05 ETH`,
      );
    });

    it("buys, approves and sells back to native ETH in one sequence", async () => {
      const spend = parseEther("0.05");

      const buy = await buildBuy({
        client,
        token,
        user: TRADER,
        ethAmountWei: spend,
      });

      const expected = await quoteBuy(client, token, spend);

      // Sell slightly less than the quote so the sell leg cannot fail purely
      // because execution returned a few wei fewer tokens than quoted.
      const sellAmount = (expected * 90n) / 100n;

      const approve = buildApprove(token);

      const sell = await buildSell({
        client,
        token,
        user: TRADER,
        tokenAmount: sellAmount,
      });

      const { results } = await client.simulateCalls({
        account: TRADER,
        stateOverrides: OVERRIDES,
        calls: [
          {
            to: buy.address,
            abi: buy.abi,
            functionName: buy.functionName,
            args: buy.args,
            value: buy.value,
          } as never,
          {
            to: approve.address,
            abi: approve.abi,
            functionName: approve.functionName,
            args: approve.args,
          } as never,
          {
            to: sell.address,
            abi: sell.abi,
            functionName: sell.functionName,
            args: sell.args,
          } as never,
          {
            to: token,
            abi: PONS_BALANCE_ABI,
            functionName: "balanceOf",
            args: [TRADER],
          } as never,
        ],
      });

      assert.equal(results[0].status, "success", "buy leg should succeed");
      assert.equal(results[1].status, "success", "approve leg should succeed");
      assert.equal(results[2].status, "success", "sell multicall should succeed");

      const remaining = results[3].result as bigint;

      assert.ok(
        remaining > 0n && remaining < expected,
        "selling 90% should leave a smaller non-zero balance",
      );

      console.log(
        `      sold ${Number(formatEther(sellAmount)).toLocaleString()} ${state.symbol}, ` +
          `${Number(formatEther(remaining)).toLocaleString()} left`,
      );
    });

    it("encodes the sell as a swap plus an unwrap so the seller gets native ETH", async () => {
      const sell = await buildSell({
        client,
        token,
        user: TRADER,
        tokenAmount: parseEther("1000"),
      });

      assert.equal(sell.address, SWAP_ROUTER);
      assert.equal(sell.functionName, "multicall");

      const legs = (sell.args as readonly (readonly `0x${string}`[])[])[0];

      assert.equal(legs.length, 2, "sell should be exactly two legs");
      assert.ok(legs[0].startsWith("0x04e45aaf"), "leg 1 should be exactInputSingle");
      assert.ok(legs[1].startsWith("0x49404b7c"), "leg 2 should be unwrapWETH9");
    });

    it("fails the sell without an approval", async () => {
      const sellAmount = parseEther("1000");

      const buy = await buildBuy({
        client,
        token,
        user: TRADER,
        ethAmountWei: parseEther("0.05"),
      });

      const sell = await buildSell({
        client,
        token,
        user: TRADER,
        tokenAmount: sellAmount,
      });

      const { results } = await client.simulateCalls({
        account: TRADER,
        stateOverrides: OVERRIDES,
        calls: [
          {
            to: buy.address,
            abi: buy.abi,
            functionName: buy.functionName,
            args: buy.args,
            value: buy.value,
          } as never,
          // Deliberately no approve here.
          {
            to: sell.address,
            abi: sell.abi,
            functionName: sell.functionName,
            args: sell.args,
          } as never,
        ],
      });

      assert.equal(results[0].status, "success", "buy should still succeed");
      assert.equal(
        results[1].status,
        "failure",
        "sell must fail without an ERC-20 allowance",
      );
    });
  });
});

const PONS_BALANCE_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;
