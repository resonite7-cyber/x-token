import {
  encodeDeployData,
  encodeFunctionData,
  getContractAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import { POOL_FEE, POSITION_MANAGER, UNISWAP_V3_FACTORY, WETH } from "./addresses";
import { TOKEN_ABI, TOKEN_BYTECODE } from "./tokenArtifact";

/*
 * Direct launch — the same outcome as Pons, without the Pons factory.
 *
 * The Pons factory reports `launchEnabled = false` and only its owner can flip
 * that, so the hosted launch path is closed to us indefinitely. Uniswap V3 on
 * Robinhood Chain is not: `createPool` is permissionless (the factory owner
 * only gates which fee tiers exist, and 500 / 3000 / 10000 are all live), so a
 * plain ERC-20 plus a pool plus an LP position reproduces what Pons does.
 *
 * Three wallet signatures, in this order:
 *
 *   1. deploy contracts/Token.sol
 *   2. approve the position manager to pull the pool's token side
 *   3. one position-manager multicall: create+initialise the pool, mint the
 *      full-range position, refund unspent ETH
 *
 * The ETH side needs no wrap or approval: NonfungiblePositionManager is an
 * IPeripheryPayments contract, so it wraps msg.value into WETH itself and
 * `refundETH` returns whatever the mint did not consume.
 *
 * What this does NOT reproduce: Pons pays the creator 70% of trading fees and
 * locks the LP position in PONS_LOCKER. Here the position NFT lands in the
 * creator's wallet, which means the liquidity is theirs to withdraw — more
 * control, but visible to buyers as rug risk. See lockAdvice() below.
 */

/** Tick spacing per fee tier, from the Uniswap V3 factory's defaults. */
const TICK_SPACING: Record<number, number> = { 500: 10, 3000: 60, 10000: 200 };

/** Uniswap's hard tick bound; a full-range position rounds inward to spacing. */
const MAX_TICK_BOUND = 887272;

export interface DirectLaunchParams {
  name: string;
  symbol: string;
  /** Whole tokens. The constructor multiplies by 1e18. */
  totalSupply: bigint;
  /** Whole tokens seeded as liquidity. Must be <= totalSupply. */
  tokensToPool: bigint;
  /** Wei of ETH seeded as liquidity. With tokensToPool this sets the price. */
  ethToPool: bigint;
  /** Receives the whole supply, then the LP position. */
  creator: Address;
  /** Pool fee tier in hundredths of a bip. Defaults to Pons's own 1%. */
  fee?: number;
}

export interface DirectWrite {
  address: Address;
  abi: readonly unknown[];
  functionName: string;
  args: readonly unknown[];
  value?: bigint;
}

const WAD = 10n ** 18n;

/** Integer square root, for sqrtPriceX96 — Number would lose precision here. */
function isqrt(n: bigint): bigint {
  if (n < 2n) return n;

  let x = n;
  let y = (x + 1n) / 2n;

  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }

  return x;
}

/**
 * sqrt(amount1 / amount0) * 2^96, computed entirely in integers by shifting
 * the numerator up by 192 bits before the square root rather than after.
 */
export function encodeSqrtPriceX96(amount0: bigint, amount1: bigint): bigint {
  if (amount0 <= 0n || amount1 <= 0n) {
    throw new Error("Both pool amounts must be greater than zero.");
  }

  return isqrt((amount1 << 192n) / amount0);
}

/** Token/WETH ordering and the amounts that go with it. Uniswap sorts by address. */
export function orderPool(token: Address, tokenAmount: bigint, ethAmount: bigint) {
  const tokenIsFirst = token.toLowerCase() < WETH.toLowerCase();

  return {
    token0: (tokenIsFirst ? token : WETH) as Address,
    token1: (tokenIsFirst ? WETH : token) as Address,
    amount0: tokenIsFirst ? tokenAmount : ethAmount,
    amount1: tokenIsFirst ? ethAmount : tokenAmount,
    tokenIsFirst,
  };
}

function validate(params: DirectLaunchParams) {
  const fee = params.fee ?? POOL_FEE;

  if (!TICK_SPACING[fee]) {
    throw new Error(`Unsupported fee tier ${fee}. Use 500, 3000 or 10000.`);
  }

  if (!params.name.trim() || !params.symbol.trim()) {
    throw new Error("Name and symbol are both required.");
  }

  if (params.totalSupply <= 0n) {
    throw new Error("Total supply must be greater than zero.");
  }

  if (params.tokensToPool <= 0n || params.tokensToPool > params.totalSupply) {
    throw new Error("Tokens for liquidity must be between 1 and the total supply.");
  }

  if (params.ethToPool <= 0n) {
    throw new Error("Seed the pool with more than zero ETH, or nobody can trade it.");
  }

  return fee;
}

/**
 * Step 1 — the token deployment, as wagmi `useDeployContract` arguments.
 *
 * Token.sol takes the supply in whole tokens and mints supply * 1e18 to the
 * owner, so totalSupply is passed through unscaled.
 */
export function buildTokenDeploy(params: DirectLaunchParams) {
  validate(params);

  return {
    abi: TOKEN_ABI,
    bytecode: TOKEN_BYTECODE,
    args: [
      params.name.trim(),
      params.symbol.trim().toUpperCase(),
      params.totalSupply,
      params.creator,
    ] as const,
  };
}

/** The raw deployment calldata, for simulating before anything is signed. */
export function encodeTokenDeploy(params: DirectLaunchParams): Hex {
  const deploy = buildTokenDeploy(params);

  return encodeDeployData({
    abi: deploy.abi,
    bytecode: deploy.bytecode,
    args: deploy.args as never,
  });
}

/**
 * The address a plain CREATE deployment will land on. Unlike Pons's CREATE2
 * factory this depends on the deployer's nonce, so it is only stable until the
 * creator sends another transaction.
 */
export function predictDirectTokenAddress(deployer: Address, nonce: bigint): Address {
  return getContractAddress({ from: deployer, nonce });
}

/** Step 2 — let the position manager pull the token side of the liquidity. */
export function buildPoolApprove(token: Address, tokensToPool: bigint): DirectWrite {
  return {
    address: token,
    abi: TOKEN_ABI,
    functionName: "approve",
    args: [POSITION_MANAGER, tokensToPool * WAD],
  };
}

/**
 * Step 3 — create the pool, mint a full-range position and refund the change,
 * batched into one position-manager multicall so it is a single signature.
 *
 * A full-range position is what Pons mints and is the only sane default here:
 * a concentrated range would leave the token untradeable the moment price left
 * the band.
 */
export function buildPoolCreation({
  token,
  params,
  deadlineSeconds = 1800,
}: {
  token: Address;
  params: DirectLaunchParams;
  deadlineSeconds?: number;
}): DirectWrite {
  const fee = validate(params);
  const spacing = TICK_SPACING[fee];

  const scaledTokens = params.tokensToPool * WAD;
  const { token0, token1, amount0, amount1 } = orderPool(token, scaledTokens, params.ethToPool);

  const sqrtPriceX96 = encodeSqrtPriceX96(amount0, amount1);

  const tickUpper = Math.floor(MAX_TICK_BOUND / spacing) * spacing;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineSeconds);

  const createCall = encodeFunctionData({
    abi: POSITION_MANAGER_ABI,
    functionName: "createAndInitializePoolIfNecessary",
    args: [token0, token1, fee, sqrtPriceX96],
  });

  const mintCall = encodeFunctionData({
    abi: POSITION_MANAGER_ABI,
    functionName: "mint",
    args: [
      {
        token0,
        token1,
        fee,
        tickLower: -tickUpper,
        tickUpper,
        amount0Desired: amount0,
        amount1Desired: amount1,
        // The pool is brand new and we set its price, so nothing can move
        // between initialise and mint inside a single multicall.
        amount0Min: 0n,
        amount1Min: 0n,
        recipient: params.creator,
        deadline,
      },
    ],
  });

  const refundCall = encodeFunctionData({
    abi: POSITION_MANAGER_ABI,
    functionName: "refundETH",
    args: [],
  });

  return {
    address: POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: "multicall",
    args: [[createCall, mintCall, refundCall]],
    value: params.ethToPool,
  };
}

/**
 * The whole launch as one eth_simulateV1 sequence: the three signed calls
 * followed by two reads that confirm the outcome.
 *
 * eth_simulateV1 carries state between calls, so the pool really is created
 * and the position really is minted against current mainnet state — the only
 * thing missing versus signing is the signature. This is the substitute for a
 * testnet, which on this chain has no Uniswap deployed at all.
 *
 * Both the preflight in the launch UI and test/direct.launch.ts build their
 * calls here, so what the user previews is what the tests cover.
 */
export function buildLaunchSequence({
  token,
  params,
}: {
  token: Address;
  params: DirectLaunchParams;
}) {
  const approve = buildPoolApprove(token, params.tokensToPool);
  const create = buildPoolCreation({ token, params });
  const { token0, token1 } = orderPool(token, 1n, 1n);

  return [
    { to: null, data: encodeTokenDeploy(params) },
    {
      to: approve.address,
      abi: approve.abi,
      functionName: approve.functionName,
      args: approve.args,
    },
    {
      to: create.address,
      abi: create.abi,
      functionName: create.functionName,
      args: create.args,
      value: create.value,
    },
    {
      to: UNISWAP_V3_FACTORY,
      abi: V3_FACTORY_ABI,
      functionName: "getPool",
      args: [token0, token1, params.fee ?? POOL_FEE],
    },
    {
      to: token,
      abi: TOKEN_ABI,
      functionName: "balanceOf",
      args: [params.creator],
    },
  ];
}

/** Human labels for buildLaunchSequence, in the same order. */
export const LAUNCH_STEP_LABELS = [
  "Deploy token",
  "Approve liquidity",
  "Create pool + mint position",
  "Confirm pool address",
  "Confirm your balance",
] as const;

/** Where the pool will live, once created. Zero address means not yet created. */
export async function getPoolAddress({
  client,
  token,
  fee = POOL_FEE,
}: {
  client: PublicClient;
  token: Address;
  fee?: number;
}): Promise<Address> {
  const { token0, token1 } = orderPool(token, 1n, 1n);

  return (await client.readContract({
    address: UNISWAP_V3_FACTORY,
    abi: V3_FACTORY_ABI,
    functionName: "getPool",
    args: [token0, token1, fee],
  })) as Address;
}

/**
 * Opening price in ETH per whole token, straight from the seeded ratio.
 *
 * ethToPool is wei and tokensToPool * WAD is base units, and both scale by
 * 1e18, so the ratio is already ETH per whole token — no further scaling.
 */
export function openingPriceEth(params: DirectLaunchParams): number {
  return Number(params.ethToPool) / Number(params.tokensToPool * WAD);
}

/**
 * Opening fully-diluted valuation in ETH: price per whole token times the
 * supply in whole tokens. Scaling the supply to base units here would inflate
 * the answer by 1e18.
 */
export function openingFdvEth(params: DirectLaunchParams): number {
  return openingPriceEth(params) * Number(params.totalSupply);
}

/** Total ETH the launch moves, excluding gas. */
export function requiredEth(params: DirectLaunchParams): bigint {
  return params.ethToPool;
}

export const POSITION_MANAGER_ABI = [
  {
    type: "function",
    name: "createAndInitializePoolIfNecessary",
    stateMutability: "payable",
    inputs: [
      { name: "token0", type: "address" },
      { name: "token1", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "sqrtPriceX96", type: "uint160" },
    ],
    outputs: [{ name: "pool", type: "address" }],
  },
  {
    type: "function",
    name: "mint",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "token0", type: "address" },
          { name: "token1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickLower", type: "int24" },
          { name: "tickUpper", type: "int24" },
          { name: "amount0Desired", type: "uint256" },
          { name: "amount1Desired", type: "uint256" },
          { name: "amount0Min", type: "uint256" },
          { name: "amount1Min", type: "uint256" },
          { name: "recipient", type: "address" },
          { name: "deadline", type: "uint256" },
        ],
      },
    ],
    outputs: [
      { name: "tokenId", type: "uint256" },
      { name: "liquidity", type: "uint128" },
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "multicall",
    stateMutability: "payable",
    inputs: [{ name: "data", type: "bytes[]" }],
    outputs: [{ name: "results", type: "bytes[]" }],
  },
  { type: "function", name: "refundETH", stateMutability: "payable", inputs: [], outputs: [] },
  {
    type: "function",
    name: "positions",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      { name: "nonce", type: "uint96" },
      { name: "operator", type: "address" },
      { name: "token0", type: "address" },
      { name: "token1", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "tickLower", type: "int24" },
      { name: "tickUpper", type: "int24" },
      { name: "liquidity", type: "uint128" },
      { name: "feeGrowthInside0LastX128", type: "uint256" },
      { name: "feeGrowthInside1LastX128", type: "uint256" },
      { name: "tokensOwed0", type: "uint128" },
      { name: "tokensOwed1", type: "uint128" },
    ],
  },
] as const;

export const V3_FACTORY_ABI = [
  {
    type: "function",
    name: "getPool",
    stateMutability: "view",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
      { name: "fee", type: "uint24" },
    ],
    outputs: [{ name: "pool", type: "address" }],
  },
] as const;
