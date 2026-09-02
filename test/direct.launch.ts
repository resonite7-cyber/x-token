import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import {
  decodeAbiParameters,
  formatEther,
  parseEther,
  type Address,
  type Hex,
  type SimulateCallsReturnType,
} from "viem";

import { getPonsClient } from "../app/src/lib/pons/trade.js";
import {
  POOL_FEE,
  POSITION_MANAGER,
  UNISWAP_V3_FACTORY,
  WETH,
} from "../app/src/lib/pons/addresses.js";
import {
  V3_FACTORY_ABI,
  buildLaunchSequence,
  buildPoolCreation,
  encodeSqrtPriceX96,
  openingFdvEth,
  openingPriceEth,
  orderPool,
  predictDirectTokenAddress,
  type DirectLaunchParams,
} from "../app/src/lib/pons/directLaunch.js";

/*
 * The direct launch path, simulated against live Robinhood Chain mainnet.
 *
 * This is the route the app uses because the Pons factory reports
 * launchEnabled = false and only its owner can change that — see the header of
 * test/pons.launch.ts for how that flag was located. Uniswap V3 here is
 * permissionless, so these three calls are a complete launch:
 *
 *   deploy Token  ->  approve position manager  ->  create pool + mint LP
 *
 * eth_simulateV1 runs them as a sequence against real current state with state
 * carried between calls, so the pool really is created and the position really
 * is minted, through the deployed Uniswap bytecode. Nothing is signed and no
 * funds are needed.
 */

const client = getPonsClient();

/** Funded only inside the simulation; this key does not exist. */
const CREATOR: Address = "0x4444444444444444444444444444444444444444";

/** A never-used address has nonce 0, so CREATE lands here. */
const CREATOR_NONCE = 0n;

const PARAMS: DirectLaunchParams = {
  name: "Direct Test Token",
  symbol: "DTT",
  totalSupply: 1_000_000_000n,
  tokensToPool: 200_000_000n,
  ethToPool: parseEther("0.1"),
  creator: CREATOR,
};

const WAD = 10n ** 18n;

const OVERRIDES = [{ address: CREATOR, balance: parseEther("10") }];

/** simulateCalls results carry bigints, which JSON.stringify refuses. */
function show(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? `${v}` : v));
}

describe("Direct launch on Robinhood Chain (mainnet, simulated)", () => {
  const token = predictDirectTokenAddress(CREATOR, CREATOR_NONCE);

  let results: SimulateCallsReturnType["results"];
  let pool: Address;

  before(async () => {
    ({ results } = await client.simulateCalls({
      account: CREATOR,
      stateOverrides: OVERRIDES,
      calls: buildLaunchSequence({ token, params: PARAMS }) as never[],
    }));

    pool = results[3].result as Address;
  });

  describe("preconditions", () => {
    it("has the Uniswap V3 periphery deployed", async () => {
      for (const address of [UNISWAP_V3_FACTORY, POSITION_MANAGER, WETH]) {
        const code = await client.getCode({ address });

        assert.ok(code && code !== "0x", `${address} should have code`);
      }
    });

    it("has no pool for a token that does not exist yet", async () => {
      const { token0, token1 } = orderPool(token, 1n, 1n);

      const existing = await client.readContract({
        address: UNISWAP_V3_FACTORY,
        abi: V3_FACTORY_ABI,
        functionName: "getPool",
        args: [token0, token1, POOL_FEE],
      });

      assert.equal(
        existing,
        "0x0000000000000000000000000000000000000000",
        "the simulated token must not already have a pool",
      );
    });
  });

  describe("the three-signature sequence", () => {
    it("deploys the token", () => {
      assert.equal(results[0].status, "success", show(results[0]));
    });

    it("approves the position manager", () => {
      assert.equal(results[1].status, "success", show(results[1]));
    });

    it("creates the pool and mints the position in one multicall", () => {
      assert.equal(results[2].status, "success", show(results[2]));

      const returned = results[2].result as readonly Hex[];

      assert.equal(returned.length, 3, "create, mint and refund should all return");

      const [createdPool] = decodeAbiParameters([{ type: "address" }], returned[0]);
      const [tokenId, liquidity] = decodeAbiParameters(
        [{ type: "uint256" }, { type: "uint128" }, { type: "uint256" }, { type: "uint256" }],
        returned[1],
      );

      assert.notEqual(
        createdPool,
        "0x0000000000000000000000000000000000000000",
        "a pool should have been created",
      );
      assert.ok(tokenId > 0n, "a position NFT should have been minted");
      assert.ok(liquidity > 0n, "the position should hold liquidity");

      console.log(
        `      token ${token}\n      pool  ${createdPool}\n` +
          `      position #${tokenId} with ${liquidity} liquidity`,
      );
    });

    it("registers the pool with the Uniswap factory", () => {
      assert.equal(results[3].status, "success", show(results[3]));

      const returned = results[2].result as readonly Hex[];
      const [createdPool] = decodeAbiParameters([{ type: "address" }], returned[0]);

      assert.equal(pool, createdPool, "factory and multicall should agree on the pool");
    });

    it("leaves the creator holding the supply that did not go into the pool", () => {
      assert.equal(results[4].status, "success", show(results[4]));

      const balance = results[4].result as bigint;
      const kept = (PARAMS.totalSupply - PARAMS.tokensToPool) * WAD;

      // Uniswap derives liquidity from the desired amounts and rounds down, so
      // a few thousand wei of token never make it into the pool and stay with
      // the creator. Dust, but it means this cannot be an equality check.
      const dust = balance - kept;

      assert.ok(dust >= 0n, `creator should keep at least ${kept}, got ${balance}`);
      assert.ok(
        dust * 1_000_000_000n < PARAMS.tokensToPool * WAD,
        `unpooled dust ${dust} is too large to be rounding`,
      );

      console.log(
        `      creator keeps ${Number(formatEther(balance)).toLocaleString()} ${PARAMS.symbol}` +
          ` (+${dust} wei of pool dust)`,
      );
    });
  });

  describe("pricing", () => {
    it("opens the pool at the price implied by the seeded amounts", async () => {
      // A second pass, now that the pool address is known, so slot0 can be read
      // inside the same simulated state that created it.
      const { results: priced } = await client.simulateCalls({
        account: CREATOR,
        stateOverrides: OVERRIDES,
        calls: [
          ...buildLaunchSequence({ token, params: PARAMS }) as never[],
          {
            to: pool,
            abi: POOL_ABI,
            functionName: "slot0",
            args: [],
          },
        ] as never[],
      });

      const slot0 = priced[5];

      assert.equal(slot0.status, "success", show(slot0));

      const actual = (slot0.result as readonly unknown[])[0] as bigint;

      const { amount0, amount1 } = orderPool(
        token,
        PARAMS.tokensToPool * WAD,
        PARAMS.ethToPool,
      );

      assert.equal(
        actual,
        encodeSqrtPriceX96(amount0, amount1),
        "pool should open at exactly the price we encoded",
      );

      console.log(
        `      opening price ${openingPriceEth(PARAMS).toExponential(3)} ETH per ${PARAMS.symbol}`,
      );
    });

    it("values the whole supply from the seeded slice", () => {
      // 200M of a 1B supply seeded with 0.1 ETH prices the pool at 0.5 ETH for
      // all 1B. Getting the token decimals wrong here inflates FDV by 1e18.
      assert.ok(
        Math.abs(openingFdvEth(PARAMS) - 0.5) < 1e-9,
        `expected 0.5 ETH FDV, got ${openingFdvEth(PARAMS)}`,
      );

      const tenBillion = { ...PARAMS, totalSupply: 10_000_000_000n };

      assert.ok(
        Math.abs(openingFdvEth(tenBillion) - 5) < 1e-9,
        `expected 5 ETH FDV, got ${openingFdvEth(tenBillion)}`,
      );
    });

    it("prices one whole token, not one base unit", () => {
      assert.ok(
        Math.abs(openingPriceEth(PARAMS) - 5e-10) < 1e-20,
        `expected 5e-10, got ${openingPriceEth(PARAMS)}`,
      );
    });

    it("encodes a 1:1 ratio as 2^96", () => {
      assert.equal(encodeSqrtPriceX96(WAD, WAD), 2n ** 96n);
    });

    it("encodes a 4:1 ratio as twice 2^96", () => {
      assert.equal(encodeSqrtPriceX96(WAD, 4n * WAD), 2n * 2n ** 96n);
    });
  });

  describe("validation", () => {
    const cases: [string, Partial<DirectLaunchParams>, RegExp][] = [
      ["an unsupported fee tier", { fee: 1234 }, /Unsupported fee tier/],
      ["a blank symbol", { symbol: "  " }, /Name and symbol/],
      ["zero supply", { totalSupply: 0n }, /Total supply/],
      ["pooling more than the supply", { tokensToPool: 2_000_000_000n }, /between 1 and the total supply/],
      ["no ETH", { ethToPool: 0n }, /more than zero ETH/],
    ];

    for (const [label, patch, pattern] of cases) {
      it(`rejects ${label} before anything is signed`, () => {
        assert.throws(
          () => buildPoolCreation({ token, params: { ...PARAMS, ...patch } }),
          pattern,
        );
      });
    }
  });
});

const POOL_ABI = [
  {
    type: "function",
    name: "slot0",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "observationIndex", type: "uint16" },
      { name: "observationCardinality", type: "uint16" },
      { name: "observationCardinalityNext", type: "uint16" },
      { name: "feeProtocol", type: "uint8" },
      { name: "unlocked", type: "bool" },
    ],
  },
] as const;
