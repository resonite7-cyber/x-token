import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import {
  formatEther,
  parseEther,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import {
  buildLaunch,
  getLaunchFee,
  getPonsClient,
  isLaunchEnabled,
  predictTokenAddress,
  type LaunchParams,
} from "../app/src/lib/pons/trade.js";

import { PONS_FACTORY } from "../app/src/lib/pons/addresses.js";

/*
 * Launch-path tests for the Pons integration, run against Robinhood Chain
 * mainnet with eth_simulateV1. Nothing is signed and no funds are needed.
 *
 * WHY THIS NEEDS A STATE OVERRIDE
 *
 * The factory owner has launches switched off — launchEnabled() returns false
 * on mainnet right now — so a plain simulation of launchToken() reverts before
 * it does anything interesting. Testnet is not an escape hatch: chain 46630
 * has zero bytes of code at the factory, the Uniswap V3 factory, the position
 * manager, SwapRouter02, QuoterV2 and WETH. Only Multicall3 is deployed there.
 *
 * So we flip the flag in the simulation instead. launchEnabled lives in
 * storage slot 3, byte offset 0, of the factory; the slot is otherwise zero,
 * so writing 0x..01 sets the bool and clobbers nothing. The slot was located
 * by scanning slots 0..47 and re-reading launchEnabled() under a stateDiff
 * until it flipped, not by guessing at a layout we do not have source for.
 * "matches the deployed contract" below re-proves that on every run, so an
 * upgrade that moves the flag fails loudly instead of quietly testing nothing.
 *
 * Everything downstream of the flag is the real thing: real factory bytecode,
 * the real Uniswap V3 periphery, real pool creation.
 */

const client = getPonsClient();

/** Funded only inside the simulation; this key does not exist. */
const CREATOR: Address = "0x2222222222222222222222222222222222222222";

const LAUNCH_ENABLED_SLOT: Hex = `0x${"0".repeat(63)}3`;
const SLOT_TRUE: Hex = `0x${"0".repeat(63)}1`;

const PARAMS: LaunchParams = {
  name: "Simulation Probe",
  symbol: "PROBE",
  logo: "ipfs://bafkreiczsrzsxwyjuhpdfjagcbtrxo6zdnkllfsbjnpthqkjnnpdtrxvpa",
  description: "Launch-path integration probe. Never actually deployed.",
  socials: { twitter: "https://x.com/example" },
  feeWallet: CREATOR,
};

/** Fixed supply the launch page promises the user. */
const EXPECTED_SUPPLY = 1_000_000_000n * 10n ** 18n;

/** simulateCalls results carry bigints, which JSON.stringify refuses. */
function show(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    typeof v === "bigint" ? `${v}` : v,
  );
}

const ERC20_ABI = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalSupply",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const LAUNCH_ENABLED_ABI = [
  {
    inputs: [],
    name: "launchEnabled",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

/**
 * buildLaunch refuses to build while the factory flag is off, which is correct
 * in the app and unhelpful here. This lets the real builder run so the calldata
 * under test is the calldata the UI would send — only the flag read is stubbed.
 */
function withLaunchesEnabled(base: PublicClient): PublicClient {
  return new Proxy(base, {
    get(target, prop, receiver) {
      if (prop !== "readContract") return Reflect.get(target, prop, receiver);

      return async (args: { functionName?: string }) =>
        args?.functionName === "launchEnabled"
          ? true
          : (target.readContract as (a: unknown) => Promise<unknown>)(args);
    },
  }) as PublicClient;
}

function overrides(extra: { creatorBalance?: bigint } = {}) {
  return [
    { address: CREATOR, balance: extra.creatorBalance ?? parseEther("100") },
    {
      address: PONS_FACTORY,
      stateDiff: [{ slot: LAUNCH_ENABLED_SLOT, value: SLOT_TRUE }],
    },
  ];
}

describe("Pons launch path (mainnet, simulated)", () => {
  let launchFee: bigint;

  before(async () => {
    launchFee = await getLaunchFee(client);

    console.log(`      launch fee ${formatEther(launchFee)} ETH`);
  });

  describe("the on-chain flag", () => {
    it("is currently false, so the UI banner is telling the truth", async () => {
      assert.equal(await isLaunchEnabled(client), false);
    });

    it("makes buildLaunch refuse instead of sending a reverting tx", async () => {
      await assert.rejects(
        () => buildLaunch({ client, params: PARAMS }),
        /currently disabled/,
      );
    });

    it("matches the deployed contract at slot 3 — guards the override", async () => {
      const enabled = await client.readContract({
        address: PONS_FACTORY,
        abi: LAUNCH_ENABLED_ABI,
        functionName: "launchEnabled",
        stateOverride: [
          {
            address: PONS_FACTORY,
            stateDiff: [{ slot: LAUNCH_ENABLED_SLOT, value: SLOT_TRUE }],
          },
        ],
      });

      assert.equal(
        enabled,
        true,
        "slot 3 no longer holds launchEnabled — the factory was likely upgraded, " +
          "and every simulation below is testing nothing until the slot is re-derived",
      );
    });
  });

  describe("execution (eth_simulateV1 against live state)", () => {
    it("launches a token and creates its pool", async () => {
      const { write, salt } = await buildLaunch({
        client: withLaunchesEnabled(client),
        params: PARAMS,
      });

      const predicted = await predictTokenAddress({
        client,
        params: PARAMS,
        salt,
        deployer: CREATOR,
      });

      const { results } = await client.simulateCalls({
        account: CREATOR,
        stateOverrides: overrides(),
        calls: [
          {
            to: write.address,
            abi: write.abi,
            functionName: write.functionName,
            args: write.args,
            value: write.value,
          } as never,
          {
            to: predicted,
            abi: ERC20_ABI,
            functionName: "totalSupply",
          } as never,
        ],
      });

      assert.equal(
        results[0].status,
        "success",
        `launch reverted: ${show(results[0])}`,
      );

      const launched = results[0].result as Address;

      assert.equal(
        launched.toLowerCase(),
        predicted.toLowerCase(),
        "predictTokenAddress must match what the launch actually deploys — " +
          "the UI shows this address before the user signs",
      );

      assert.equal(
        results[1].result as bigint,
        EXPECTED_SUPPLY,
        "supply should be the fixed 1,000,000,000 the launch page advertises",
      );

      console.log(`      launched ${launched} with the predicted address`);
    });

    it("reverts when the launch fee is underpaid", async () => {
      const { write } = await buildLaunch({
        client: withLaunchesEnabled(client),
        params: PARAMS,
      });

      const { results } = await client.simulateCalls({
        account: CREATOR,
        stateOverrides: overrides(),
        calls: [
          {
            to: write.address,
            abi: write.abi,
            functionName: write.functionName,
            args: write.args,
            value: launchFee - 1n,
          } as never,
        ],
      });

      assert.equal(
        results[0].status,
        "failure",
        "underpaying the launch fee should revert",
      );
    });

    it("gives the creator tokens when a dev buy is attached", async () => {
      const devBuy = parseEther("0.05");

      const { write, salt } = await buildLaunch({
        client: withLaunchesEnabled(client),
        params: { ...PARAMS, initialBuyWei: devBuy },
      });

      assert.equal(
        write.value,
        launchFee + devBuy,
        "value must carry the dev buy on top of the launch fee",
      );

      const predicted = await predictTokenAddress({
        client,
        params: PARAMS,
        salt,
        deployer: CREATOR,
      });

      const { results } = await client.simulateCalls({
        account: CREATOR,
        stateOverrides: overrides(),
        calls: [
          {
            to: write.address,
            abi: write.abi,
            functionName: write.functionName,
            args: write.args,
            value: write.value,
          } as never,
          {
            to: predicted,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [CREATOR],
          } as never,
        ],
      });

      assert.equal(
        results[0].status,
        "success",
        `launch with dev buy reverted: ${show(results[0])}`,
      );

      const balance = results[1].result as bigint;

      assert.ok(
        balance > 0n,
        "creator should hold tokens from the same-transaction dev buy",
      );

      assert.ok(
        balance < EXPECTED_SUPPLY,
        "a 0.05 ETH dev buy should not acquire the entire supply",
      );

      console.log(
        `      dev buy of 0.05 ETH returned ${Number(formatEther(balance)).toLocaleString()} PROBE`,
      );
    });
  });
});
