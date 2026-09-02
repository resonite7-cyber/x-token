import {
  createPublicClient,
  encodeFunctionData,
  http,
  maxUint256,
  parseEventLogs,
  type Address,
  type Hex,
  type Abi,
  type PublicClient,
} from "viem";

import {
  PONS_FACTORY_ABI,
  PONS_TOKEN_ABI,
  QUOTER_V2_ABI,
  SWAP_ROUTER_02_ABI,
  UNISWAP_V3_POOL_ABI,
} from "./abi";

import {
  ADDRESS_THIS,
  DEFAULT_SLIPPAGE_PERCENT,
  DEX_ID,
  LAUNCH_CONFIG_ID,
  PONS_FACTORY,
  PONS_FACTORY_START_BLOCK,
  PONS_LEGACY_FACTORY,
  PONS_LEGACY_FACTORY_START_BLOCK,
  POOL_FEE,
  QUOTER_V2,
  SWAP_ROUTER,
  WETH,
} from "./addresses";

import { robinhoodChain, ROBINHOOD_RPC_URL } from "./chain";

import { scanLogs, scanLogsBackward } from "./scan";

export function getPonsClient(): PublicClient {
  return createPublicClient({
    chain: robinhoodChain,
    transport: http(ROBINHOOD_RPC_URL),
    // Coalesce concurrent reads into Multicall3 calls. getTokenState alone
    // issues ~10 reads; unbatched that is 10 chances to be throttled.
    batch: { multicall: { wait: 12 } },
  }) as PublicClient;
}

/* ------------------------------------------------------------------ *
 * Pricing
 *
 * Pons pools are plain Uniswap V3, so price comes from slot0 rather than
 * from bonding-curve reserves. Both sides are 18 decimals (WETH and every
 * PonsLauncherToken), so no decimal correction is needed — but the token
 * may be either side of the pair, hence the isToken0 flag from the factory.
 * ------------------------------------------------------------------ */

const Q192 = 2n ** 192n;
const WAD = 10n ** 18n;

/** ETH per whole token, as a float safe for display. */
export function priceFromSqrtPriceX96(
  sqrtPriceX96: bigint,
  tokenIsToken0: boolean,
): number {
  if (sqrtPriceX96 === 0n) return 0;

  // token1 per token0, scaled by 1e18 so the division survives as an integer.
  const scaled = (sqrtPriceX96 * sqrtPriceX96 * WAD) / Q192;

  if (scaled === 0n) return 0;

  const token1PerToken0 = Number(scaled) / 1e18;

  return tokenIsToken0 ? token1PerToken0 : 1 / token1PerToken0;
}

export interface LaunchedToken {
  token: Address;
  deployer: Address;
  pairedToken: Address;
  positionManager: Address;
  positionId: bigint;
  dexId: bigint;
  launchConfigId: bigint;
  restrictionsEndBlock: bigint;
  supply: bigint;
  isToken0: boolean;
  poolFee: number;
  exists: boolean;
  initialBuyAmount: bigint;
}

/**
 * A token may have come from either factory. Tokens from the legacy factory
 * are still tradeable — the pool is the same Uniswap V3 deployment — so fall
 * back to it rather than treating an unknown token as invalid.
 */
export async function getLaunchedToken(
  client: PublicClient,
  token: Address,
): Promise<{ info: LaunchedToken; factory: Address } | null> {
  for (const factory of [PONS_FACTORY, PONS_LEGACY_FACTORY] as const) {
    try {
      const info = (await client.readContract({
        address: factory,
        abi: PONS_FACTORY_ABI,
        functionName: "getLaunchedToken",
        args: [token],
      })) as unknown as LaunchedToken;

      if (info.exists) return { info, factory };
    } catch {
      // Try the next factory.
    }
  }

  return null;
}

export interface TokenState {
  token: Address;
  pool: Address;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
  logo: string;
  description: string;
  socials: {
    twitter: string;
    telegram: string;
    discord: string;
    website: string;
    farcaster: string;
  };
  isToken0: boolean;
  /** ETH per whole token, from the pool's current tick. */
  priceEth: number;
  /** ETH raised toward graduation. */
  pairedPrincipal: bigint;
  graduationThreshold: bigint;
  graduated: boolean;
  /** 0-1. */
  graduationProgress: number;
  /** Anti-snipe max-wallet/max-tx caps apply until this block. */
  restrictionsEndBlock: bigint;
  restrictionsActive: boolean;
  userTokenBalance: bigint;
  userEthBalance: bigint;
}

export async function getTokenState({
  client,
  token,
  user,
}: {
  client: PublicClient;
  token: Address;
  user?: Address;
}): Promise<TokenState> {
  const launched = await getLaunchedToken(client, token);

  if (!launched) {
    throw new Error("This address is not a Pons-launched token.");
  }

  const { info, factory } = launched;

  const tokenContract = { address: token, abi: PONS_TOKEN_ABI } as const;

  const [
    name,
    symbol,
    decimals,
    totalSupply,
    logo,
    description,
    pool,
    socials,
    graduation,
    blockNumber,
  ] = await Promise.all([
    client.readContract({ ...tokenContract, functionName: "name" }),
    client.readContract({ ...tokenContract, functionName: "symbol" }),
    client.readContract({ ...tokenContract, functionName: "decimals" }),
    client.readContract({ ...tokenContract, functionName: "totalSupply" }),
    client.readContract({ ...tokenContract, functionName: "logo" }).catch(() => ""),
    client
      .readContract({ ...tokenContract, functionName: "description" })
      .catch(() => ""),
    client.readContract({ ...tokenContract, functionName: "liquidityPool" }),
    client
      .readContract({ ...tokenContract, functionName: "socials" })
      .catch(() => ["", "", "", "", ""] as const),
    client.readContract({
      address: factory,
      abi: PONS_FACTORY_ABI,
      functionName: "graduationStatus",
      args: [token],
    }),
    client.getBlockNumber(),
  ]);

  const [slot0, userTokenBalance, userEthBalance] = await Promise.all([
    client.readContract({
      address: pool as Address,
      abi: UNISWAP_V3_POOL_ABI,
      functionName: "slot0",
    }),
    user
      ? client.readContract({
          ...tokenContract,
          functionName: "balanceOf",
          args: [user],
        })
      : Promise.resolve(0n),
    user ? client.getBalance({ address: user }) : Promise.resolve(0n),
  ]);

  const [pairedPrincipal, graduationThreshold, graduated] =
    graduation as readonly [bigint, bigint, boolean];

  return {
    token,
    pool: pool as Address,
    name: name as string,
    symbol: symbol as string,
    decimals: Number(decimals),
    totalSupply: totalSupply as bigint,
    logo: logo as string,
    description: description as string,
    socials: {
      twitter: socials[0] as string,
      telegram: socials[1] as string,
      discord: socials[2] as string,
      website: socials[3] as string,
      farcaster: socials[4] as string,
    },
    isToken0: info.isToken0,
    priceEth: priceFromSqrtPriceX96(
      (slot0 as readonly unknown[])[0] as bigint,
      info.isToken0,
    ),
    pairedPrincipal,
    graduationThreshold,
    graduated,
    graduationProgress:
      graduationThreshold === 0n
        ? 0
        : Math.min(
            1,
            Number((pairedPrincipal * 10000n) / graduationThreshold) / 10000,
          ),
    restrictionsEndBlock: info.restrictionsEndBlock,
    restrictionsActive: blockNumber < info.restrictionsEndBlock,
    userTokenBalance: userTokenBalance as bigint,
    userEthBalance: userEthBalance as bigint,
  };
}

export interface TokenPrice {
  token: Address;
  priceEth: number;
  graduated: boolean;
  graduationProgress: number;
}

/** Wallet-free price lookup for the public grid. */
export async function getTokenPrice(
  client: PublicClient,
  token: Address,
): Promise<TokenPrice> {
  const launched = await getLaunchedToken(client, token);

  if (!launched) throw new Error("Not a Pons token.");

  const { info, factory } = launched;

  const pool = (await client.readContract({
    address: token,
    abi: PONS_TOKEN_ABI,
    functionName: "liquidityPool",
  })) as Address;

  const [slot0, graduation] = await Promise.all([
    client.readContract({
      address: pool,
      abi: UNISWAP_V3_POOL_ABI,
      functionName: "slot0",
    }),
    client.readContract({
      address: factory,
      abi: PONS_FACTORY_ABI,
      functionName: "graduationStatus",
      args: [token],
    }),
  ]);

  const [pairedPrincipal, threshold, graduated] = graduation as readonly [
    bigint,
    bigint,
    boolean,
  ];

  return {
    token,
    priceEth: priceFromSqrtPriceX96(
      (slot0 as readonly unknown[])[0] as bigint,
      info.isToken0,
    ),
    graduated,
    graduationProgress:
      threshold === 0n
        ? 0
        : Math.min(1, Number((pairedPrincipal * 10000n) / threshold) / 10000),
  };
}

/* ------------------------------------------------------------------ *
 * Quoting
 *
 * QuoterV2 is a non-view contract that reverts internally to return its
 * result, so it must be simulated rather than read. Its param struct on this
 * deployment orders amountIn BEFORE fee — verified against the live contract.
 * ------------------------------------------------------------------ */

async function quoteExactInputSingle(
  client: PublicClient,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: bigint,
): Promise<bigint> {
  if (amountIn <= 0n) return 0n;

  const { result } = await client.simulateContract({
    address: QUOTER_V2,
    abi: QUOTER_V2_ABI,
    functionName: "quoteExactInputSingle",
    args: [
      {
        tokenIn,
        tokenOut,
        amountIn,
        fee: POOL_FEE,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });

  return (result as readonly bigint[])[0];
}

/** Tokens received for a given amount of ETH. */
export function quoteBuy(
  client: PublicClient,
  token: Address,
  ethAmountWei: bigint,
): Promise<bigint> {
  return quoteExactInputSingle(client, WETH, token, ethAmountWei);
}

/** ETH received for a given amount of tokens. */
export function quoteSell(
  client: PublicClient,
  token: Address,
  tokenAmount: bigint,
): Promise<bigint> {
  return quoteExactInputSingle(client, token, WETH, tokenAmount);
}

function applySlippage(amount: bigint, slippagePercent: number): bigint {
  const bps = BigInt(Math.round((100 - slippagePercent) * 100));

  return (amount * bps) / 10000n;
}

/* ------------------------------------------------------------------ *
 * Trading
 *
 * These return wagmi-ready writeContract params rather than sending, so the
 * caller controls the wallet interaction — mirroring how the Solana side
 * hands back instructions instead of firing a transaction.
 * ------------------------------------------------------------------ */

export interface WriteParams {
  address: Address;
  abi: typeof SWAP_ROUTER_02_ABI | typeof PONS_TOKEN_ABI;
  functionName: string;
  args: readonly unknown[];
  value?: bigint;
}

/**
 * Buy with native ETH. SwapRouter02 wraps msg.value itself when tokenIn is
 * WETH9, so no separate wrap transaction is needed.
 */
export async function buildBuy({
  client,
  token,
  user,
  ethAmountWei,
  slippagePercent = DEFAULT_SLIPPAGE_PERCENT,
}: {
  client: PublicClient;
  token: Address;
  user: Address;
  ethAmountWei: bigint;
  slippagePercent?: number;
}): Promise<WriteParams> {
  if (ethAmountWei <= 0n) throw new Error("Enter an ETH amount.");

  const quoted = await quoteBuy(client, token, ethAmountWei);

  if (quoted === 0n) {
    throw new Error("ETH amount is too small to buy any tokens.");
  }

  return {
    address: SWAP_ROUTER,
    abi: SWAP_ROUTER_02_ABI,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn: WETH,
        tokenOut: token,
        fee: POOL_FEE,
        recipient: user,
        amountIn: ethAmountWei,
        amountOutMinimum: applySlippage(quoted, slippagePercent),
        sqrtPriceLimitX96: 0n,
      },
    ],
    value: ethAmountWei,
  };
}

/** Selling needs an ERC-20 allowance first — a step with no Solana analogue. */
export async function getAllowance(
  client: PublicClient,
  token: Address,
  user: Address,
): Promise<bigint> {
  return (await client.readContract({
    address: token,
    abi: PONS_TOKEN_ABI,
    functionName: "allowance",
    args: [user, SWAP_ROUTER],
  })) as bigint;
}

export function buildApprove(token: Address, amount = maxUint256): WriteParams {
  return {
    address: token,
    abi: PONS_TOKEN_ABI,
    functionName: "approve",
    args: [SWAP_ROUTER, amount],
  };
}

/**
 * Sell to native ETH. The swap sends WETH to the router, then unwrapWETH9
 * forwards real ETH to the user — batched through multicall so the user signs
 * once. amountOutMinimum lives on the unwrap leg so slippage is still enforced
 * if the swap leg is given a looser bound.
 */
export async function buildSell({
  client,
  token,
  user,
  tokenAmount,
  slippagePercent = DEFAULT_SLIPPAGE_PERCENT,
}: {
  client: PublicClient;
  token: Address;
  user: Address;
  tokenAmount: bigint;
  slippagePercent?: number;
}): Promise<WriteParams> {
  if (tokenAmount <= 0n) throw new Error("Enter a token amount.");

  const quoted = await quoteSell(client, token, tokenAmount);

  if (quoted === 0n) {
    throw new Error("Token amount is too small to sell for any ETH.");
  }

  const minOut = applySlippage(quoted, slippagePercent);

  const swapCall = encodeFunctionData({
    abi: SWAP_ROUTER_02_ABI,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn: token,
        tokenOut: WETH,
        fee: POOL_FEE,
        recipient: ADDRESS_THIS,
        amountIn: tokenAmount,
        amountOutMinimum: minOut,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });

  const unwrapCall = encodeFunctionData({
    abi: SWAP_ROUTER_02_ABI,
    functionName: "unwrapWETH9",
    args: [minOut, user],
  });

  return {
    address: SWAP_ROUTER,
    abi: SWAP_ROUTER_02_ABI,
    functionName: "multicall",
    args: [[swapCall, unwrapCall] as readonly Hex[]],
  };
}

/* ------------------------------------------------------------------ *
 * Discovery and history
 * ------------------------------------------------------------------ */

export interface LaunchRecord {
  token: Address;
  deployer: Address;
  pool: Address;
  positionId: bigint;
  initialBuyAmount: bigint;
  blockNumber: bigint;
  transactionHash: Hex;
  /** Which factory emitted this launch; needed to read graduationStatus. */
  factory: Address;
}

/**
 * The newest launches across BOTH factories.
 *
 * Deliberately bounded. Pons has launched well over 150,000 tokens — a full
 * index is a database's job (Bitquery and Mobula both index Robinhood Chain if
 * you need search or full history). What a market page needs is the latest
 * few dozen, and those sit at the end of the range, so this walks backwards
 * and stops as soon as it has enough.
 *
 * The legacy factory is included because it is not dormant: it produced the
 * bulk of early launches and still emitted some as recently as the active
 * factory's most recent block window.
 */
export async function getRecentLaunches({
  client,
  limit = 48,
  onProgress,
}: {
  client: PublicClient;
  limit?: number;
  onProgress?: (scannedTo: bigint, total: bigint, found: number) => void;
}): Promise<LaunchRecord[]> {
  const head = await client.getBlockNumber();

  const sources = [
    { factory: PONS_FACTORY, start: PONS_FACTORY_START_BLOCK },
    { factory: PONS_LEGACY_FACTORY, start: PONS_LEGACY_FACTORY_START_BLOCK },
  ];

  const perFactory = await Promise.all(
    sources.map(async ({ factory, start }) => {
      const logs = await scanLogsBackward<{
        args: {
          token: Address;
          deployer: Address;
          pool: Address;
          positionId: bigint;
          initialBuyAmount: bigint;
        };
        blockNumber: bigint;
        transactionHash: Hex;
      }>(client, {
        address: factory,
        abi: PONS_FACTORY_ABI as unknown as Abi,
        eventName: "TokenLaunched",
        fromBlock: start,
        toBlock: head,
        limit,
        onProgress,
      });

      return logs.map((log) => ({
        token: log.args.token,
        deployer: log.args.deployer,
        pool: log.args.pool,
        positionId: log.args.positionId,
        initialBuyAmount: log.args.initialBuyAmount,
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash,
        factory,
      }));
    }),
  );

  return perFactory
    .flat()
    .sort((a, b) => Number(b.blockNumber - a.blockNumber))
    .slice(0, limit);
}

export interface TradeHistoryEntry {
  transactionHash: Hex;
  blockNumber: bigint;
  token: Address;
  isBuy: boolean;
  ethAmount: bigint;
  tokenAmount: bigint;
}

/**
 * Reconstructs a wallet's trades for one token from the pool's Swap events.
 *
 * Attribution can't come from the Swap event itself: on a buy the recipient is
 * the user, but on a sell it is the router (the unwrap leg forwards the ETH
 * afterwards). So this filters on the token's own Transfer events, whose from
 * and to are indexed and therefore filtered by the node, then reads the ETH
 * leg out of the matching Swap in the same transaction.
 *
 * `fromBlock` should be the token's launch block — pass it from the cached
 * launch index. Without it the scan starts at the earlier factory's start
 * block, which is ~26M blocks of empty range for a recently launched token.
 *
 * There is no indexer behind this; it is a direct log scan against a
 * rate-limited RPC and is best run server-side.
 */
export async function getTokenTradeHistory({
  client,
  token,
  user,
  fromBlock,
}: {
  client: PublicClient;
  token: Address;
  user: Address;
  fromBlock?: bigint;
}): Promise<TradeHistoryEntry[]> {
  const state = await getLaunchedToken(client, token);

  if (!state) return [];

  const pool = (await client.readContract({
    address: token,
    abi: PONS_TOKEN_ABI,
    functionName: "liquidityPool",
  })) as Address;

  const head = await client.getBlockNumber();
  const start = fromBlock ?? PONS_LEGACY_FACTORY_START_BLOCK;

  const transferAbi = [
    {
      type: "event",
      name: "Transfer",
      inputs: [
        { name: "from", type: "address", indexed: true },
        { name: "to", type: "address", indexed: true },
        { name: "value", type: "uint256", indexed: false },
      ],
    },
  ] as const;

  type TransferLog = {
    args: { from: Address; to: Address; value: bigint };
    blockNumber: bigint;
    transactionHash: Hex;
  };

  const scan = (args: Record<string, unknown>) =>
    scanLogs<TransferLog>(client, {
      address: token,
      abi: transferAbi as unknown as Abi,
      eventName: "Transfer",
      args,
      fromBlock: start,
      toBlock: head,
    });

  // Two filtered scans beat one unfiltered scan: the node discards everything
  // that does not touch this wallet instead of shipping every transfer.
  const [received, sent] = await Promise.all([
    scan({ to: user }),
    scan({ from: user }),
  ]);

  const byTx = new Map<
    Hex,
    { isBuy: boolean; tokenAmount: bigint; blockNumber: bigint }
  >();

  for (const log of [...received, ...sent]) {
    const { from, to, value } = log.args;

    // Only pool-side transfers are trades; wallet-to-wallet sends are not.
    const poolIsCounterparty =
      from.toLowerCase() === pool.toLowerCase() ||
      to.toLowerCase() === pool.toLowerCase();

    if (!poolIsCounterparty) continue;

    byTx.set(log.transactionHash, {
      isBuy: to.toLowerCase() === user.toLowerCase(),
      tokenAmount: value,
      blockNumber: log.blockNumber,
    });
  }

  const entries: TradeHistoryEntry[] = [];
  const hashes = [...byTx.keys()];
  const CONCURRENCY = 8;

  for (let i = 0; i < hashes.length; i += CONCURRENCY) {
    const batch = hashes.slice(i, i + CONCURRENCY);

    const receipts = await Promise.all(
      batch.map((hash) =>
        client.getTransactionReceipt({ hash }).catch(() => null),
      ),
    );

    for (let j = 0; j < batch.length; j++) {
      const receipt = receipts[j];
      const meta = byTx.get(batch[j]);

      if (!receipt || !meta) continue;

      const swaps = parseEventLogs({
        abi: UNISWAP_V3_POOL_ABI,
        eventName: "Swap",
        logs: receipt.logs,
      }).filter((log) => log.address.toLowerCase() === pool.toLowerCase());

      if (!swaps.length) continue;

      const { amount0, amount1 } = swaps[0].args as unknown as {
        amount0: bigint;
        amount1: bigint;
      };

      // The token side is whichever slot the factory says it occupies; the
      // other side is the WETH leg.
      const ethDelta = state.info.isToken0 ? amount1 : amount0;

      entries.push({
        transactionHash: batch[j],
        blockNumber: meta.blockNumber,
        token,
        isBuy: meta.isBuy,
        ethAmount: ethDelta < 0n ? -ethDelta : ethDelta,
        tokenAmount: meta.tokenAmount,
      });
    }
  }

  return entries.sort((a, b) => Number(b.blockNumber - a.blockNumber));
}

export interface TokenSummary {
  token: Address;
  name: string;
  symbol: string;
  logo: string;
  priceEth: number;
  totalSupply: bigint;
  marketCapEth: number;
  graduated: boolean;
  graduationProgress: number;
  pairedPrincipal: bigint;
  graduationThreshold: bigint;
}

/**
 * Grid-shaped data for many tokens at once.
 *
 * Every read here goes through the Multicall3-batched client, so a 60-token
 * page costs a handful of requests rather than several hundred. Tokens that
 * fail to resolve are dropped rather than failing the whole page.
 */
export async function getTokenSummaries(
  client: PublicClient,
  tokens: Address[],
): Promise<TokenSummary[]> {
  const results = await Promise.all(
    tokens.map(async (token): Promise<TokenSummary | null> => {
      try {
        const launched = await getLaunchedToken(client, token);

        if (!launched) return null;

        const { info, factory } = launched;
        const contract = { address: token, abi: PONS_TOKEN_ABI } as const;

        const [name, symbol, logo, totalSupply, pool, graduation] =
          await Promise.all([
            client.readContract({ ...contract, functionName: "name" }),
            client.readContract({ ...contract, functionName: "symbol" }),
            client.readContract({ ...contract, functionName: "logo" }).catch(() => ""),
            client.readContract({ ...contract, functionName: "totalSupply" }),
            client.readContract({ ...contract, functionName: "liquidityPool" }),
            client.readContract({
              address: factory,
              abi: PONS_FACTORY_ABI,
              functionName: "graduationStatus",
              args: [token],
            }),
          ]);

        const slot0 = await client.readContract({
          address: pool as Address,
          abi: UNISWAP_V3_POOL_ABI,
          functionName: "slot0",
        });

        const [pairedPrincipal, threshold, graduated] = graduation as readonly [
          bigint,
          bigint,
          boolean,
        ];

        const priceEth = priceFromSqrtPriceX96(
          (slot0 as readonly unknown[])[0] as bigint,
          info.isToken0,
        );

        const supply = totalSupply as bigint;

        return {
          token,
          name: name as string,
          symbol: symbol as string,
          logo: resolveLogoUrl(logo as string),
          priceEth,
          totalSupply: supply,
          marketCapEth: priceEth * Number(supply / 10n ** 18n),
          graduated,
          graduationProgress:
            threshold === 0n
              ? 0
              : Math.min(1, Number((pairedPrincipal * 10000n) / threshold) / 10000),
          pairedPrincipal,
          graduationThreshold: threshold,
        };
      } catch {
        return null;
      }
    }),
  );

  return results.filter((r): r is TokenSummary => r !== null);
}

/* ------------------------------------------------------------------ *
 * Launching
 * ------------------------------------------------------------------ */

export interface LaunchParams {
  name: string;
  symbol: string;
  /** Image URI. Pons stores this on-chain — ipfs:// or https:// both work. */
  logo: string;
  description: string;
  socials?: Partial<{
    twitter: string;
    telegram: string;
    discord: string;
    website: string;
    farcaster: string;
  }>;
  /** Receives the creator's 70% share of trading fees. */
  feeWallet: Address;
  /** Optional same-transaction dev buy, on top of the launch fee. */
  initialBuyWei?: bigint;
}

export async function getLaunchFee(client: PublicClient): Promise<bigint> {
  return (await client.readContract({
    address: PONS_FACTORY,
    abi: PONS_FACTORY_ABI,
    functionName: "launchFee",
  })) as bigint;
}

export async function isLaunchEnabled(client: PublicClient): Promise<boolean> {
  return (await client.readContract({
    address: PONS_FACTORY,
    abi: PONS_FACTORY_ABI,
    functionName: "launchEnabled",
  })) as boolean;
}

function randomSalt(): Hex {
  const bytes = new Uint8Array(32);

  crypto.getRandomValues(bytes);

  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}` as Hex;
}

/**
 * Builds the launch call. The factory is CREATE2-based, so the token address
 * is a function of the salt and can be previewed with predictTokenAddress
 * before the user signs.
 */
export async function buildLaunch({
  client,
  params,
  salt = randomSalt(),
}: {
  client: PublicClient;
  params: LaunchParams;
  salt?: Hex;
}): Promise<{ write: WriteParams; salt: Hex; launchFee: bigint }> {
  const [launchFee, enabled] = await Promise.all([
    getLaunchFee(client),
    isLaunchEnabled(client),
  ]);

  if (!enabled) {
    throw new Error(
      "Pons launches are currently disabled on the factory contract. Trading still works; new launches will revert until the team re-enables them.",
    );
  }

  const tokenParams = {
    name: params.name,
    symbol: params.symbol,
    logo: params.logo,
    description: params.description,
    socials: {
      twitter: params.socials?.twitter ?? "",
      telegram: params.socials?.telegram ?? "",
      discord: params.socials?.discord ?? "",
      website: params.socials?.website ?? "",
      farcaster: params.socials?.farcaster ?? "",
    },
    feeWallet: params.feeWallet,
  };

  return {
    salt,
    launchFee,
    write: {
      address: PONS_FACTORY,
      abi: PONS_FACTORY_ABI as never,
      functionName: "launchToken",
      args: [tokenParams, LAUNCH_CONFIG_ID, DEX_ID, salt],
      value: launchFee + (params.initialBuyWei ?? 0n),
    },
  };
}

/** Resolves the CREATE2 address a launch would produce, before sending it. */
export async function predictTokenAddress({
  client,
  params,
  salt,
  deployer,
}: {
  client: PublicClient;
  params: LaunchParams;
  salt: Hex;
  deployer: Address;
}): Promise<Address> {
  return (await client.readContract({
    address: PONS_FACTORY,
    abi: PONS_FACTORY_ABI,
    functionName: "predictTokenAddress",
    args: [
      {
        name: params.name,
        symbol: params.symbol,
        logo: params.logo,
        description: params.description,
        socials: {
          twitter: params.socials?.twitter ?? "",
          telegram: params.socials?.telegram ?? "",
          discord: params.socials?.discord ?? "",
          website: params.socials?.website ?? "",
          farcaster: params.socials?.farcaster ?? "",
        },
        feeWallet: params.feeWallet,
      },
      LAUNCH_CONFIG_ID,
      DEX_ID,
      salt,
      deployer,
    ],
  })) as Address;
}

/**
 * A browser-loadable URL for a token's on-chain logo field.
 *
 * Two problems had to go away here. The gateway was pump.mypinata.cloud, left
 * over from when the app was on pump.fun, which answers 403 for Pons CIDs.
 * Swapping in a public gateway fixed the 403 but not the rendering: browsers
 * refused the responses cross-origin (ERR_BLOCKED_BY_RESPONSE.NotSameOrigin
 * on every ipfs.io logo), which is why some cards showed an image and some
 * did not while direct https logos were fine.
 *
 * Everything remote is therefore relayed through /api/logo on this origin,
 * which removes the cross-origin decision entirely and works for any host a
 * creator used. data: URIs are already inline and are passed through.
 */
export function resolveLogoUrl(logo: string): string {
  if (!logo) return "";

  if (logo.startsWith("data:")) return logo;

  // Idempotent on purpose: getTokenSummaries resolves logos server-side while
  // getTokenState returns the raw on-chain value, so callers legitimately hold
  // either form. Re-wrapping an already-proxied URL would break the image.
  if (logo.startsWith("/api/logo?")) return logo;

  const url = logo.startsWith("ipfs://")
    ? `https://ipfs.io/ipfs/${logo.slice("ipfs://".length)}`
    : logo;

  if (!url.startsWith("http://") && !url.startsWith("https://")) return "";

  return `/api/logo?url=${encodeURIComponent(url)}`;
}

export { PONS_LEGACY_FACTORY_START_BLOCK };
