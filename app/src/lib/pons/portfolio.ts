import {
  parseEventLogs,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import { PONS_FACTORY_ABI, PONS_TOKEN_ABI, UNISWAP_V3_POOL_ABI } from "./abi";

import {
  PONS_FACTORY,
  PONS_FACTORY_START_BLOCK,
  PONS_LEGACY_FACTORY,
  PONS_LEGACY_FACTORY_START_BLOCK,
  PONS_LOCKER,
  SWAP_ROUTER,
  WETH,
} from "./addresses";

import { scanLogs } from "./scan";

import {
  getLaunchedToken,
  getTokenSummaries,
  type LaunchedToken,
  type TokenSummary,
} from "./trade";

/*
 * Portfolio accounting for a Robinhood Chain wallet.
 *
 * WHERE THE DATA COMES FROM
 *
 * There is no indexer behind this app, so everything here is derived from
 * logs and contract reads on the Pons / Uniswap V3 deployment the rest of the
 * app already talks to. No third-party price API is involved.
 *
 *   holdings   wallet-wide ERC-20 Transfer logs give the candidate tokens,
 *              then balanceOf() gives the authoritative balance
 *   prices     getTokenSummaries() -> pool slot0/sqrtPriceX96, unchanged
 *   trades     the same Transfer logs, kept when the counterparty is the
 *              token's own pool, with the ETH leg read from the Swap event in
 *              that transaction's receipt
 *   created    TokenLaunched(deployer: user) on both factories
 *
 * WHY ONE WALLET-WIDE SCAN INSTEAD OF ONE PER TOKEN
 *
 * trade.ts's getTokenTradeHistory() answers this for a SINGLE token at a cost
 * of two log scans plus receipts. Doing that for N tokens is 2N scans against
 * a rate-limited public RPC. `Transfer` indexes both `from` and `to`, so two
 * topic-only scans with no address filter return every ERC-20 movement for
 * this wallet across every token at once — measured at 6 requests and ~9s for
 * a real wallet. Those same logs then supply the candidate set AND the trade
 * history, so nothing is scanned twice.
 *
 * DENOMINATION
 *
 * Every value here is ETH. The project has no USD price source and inventing
 * one would make these numbers look more precise than they are, so the UI
 * labels the unit rather than implying dollars.
 *
 * CONFIRMED STATE ONLY
 *
 * The snapshot is pinned to one block height. Logs, balances and prices are
 * all read at or before it, so a pending or reverted transaction can never
 * appear as a holding: reverted transactions emit no logs, and balanceOf() is
 * the authority on what the wallet actually owns.
 */

/** Nothing this app can price existed before the first factory. */
const SCAN_FLOOR = PONS_LEGACY_FACTORY_START_BLOCK;

/** Receipt/block fetches in flight at once. Matches getTokenTradeHistory. */
const CONCURRENCY = 8;

const TRANSFER_ABI = [
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

interface TransferLog {
  address: Address;
  args: { from: Address; to: Address; value: bigint };
  blockNumber: bigint;
  transactionHash: Hex;
}

export type TradeAction =
  | "BUY"
  | "SELL"
  | "DEV_BUY"
  | "CREATE"
  /** LP trading fees paid out of the Pons locker to a token's creator. */
  | "FEE_CLAIM"
  | "TRANSFER_IN"
  | "TRANSFER_OUT";

export interface PortfolioTrade {
  transactionHash: Hex;
  blockNumber: bigint;
  timestamp: number | null;
  token: Address;
  symbol: string;
  action: TradeAction;
  tokenAmount: bigint;
  /** ETH leg of the swap. Zero for CREATE and plain transfers. */
  ethAmount: bigint;
  /** ETH per whole token for this trade; null when there is no ETH leg. */
  priceEth: number | null;
}

export interface PortfolioHolding {
  token: Address;
  name: string;
  symbol: string;
  logo: string;
  decimals: number;
  /** Authoritative confirmed balance from balanceOf(). */
  balance: bigint;
  /** null when the token has no readable pool price. */
  priceEth: number | null;
  /** priceEth * balance; null when unpriced. */
  valueEth: number | null;
  /**
   * ETH still tied up in tokens acquired through tracked pool buys (the FIFO
   * lots that remain open). Excludes tokens that arrived by mint or transfer.
   */
  costBasisEth: number;
  /** Tokens covered by costBasisEth. May be less than `balance`. */
  trackedBalance: bigint;
  /** balance - trackedBalance: mint/airdrop/transfer-in, cost unknown. */
  untrackedBalance: bigint;
  avgBuyPriceEth: number | null;
  /** Over the tracked portion only; null when nothing tracked or unpriced. */
  unrealizedPnlEth: number | null;
  unrealizedPnlPercent: number | null;
  realizedPnlEth: number;
  marketCapEth: number | null;
  graduated: boolean;
  graduationProgress: number;
  isCreatedByUser: boolean;
  /** False when part of the balance has no explainable cost basis. */
  costBasisComplete: boolean;
}

export interface CreatedToken {
  token: Address;
  name: string;
  symbol: string;
  logo: string;
  priceEth: number | null;
  marketCapEth: number | null;
  /** ETH pooled toward graduation — the app's existing liquidity measure. */
  liquidityEth: number | null;
  graduated: boolean;
  graduationProgress: number;
  balance: bigint;
  transactionHash: Hex;
  blockNumber: bigint;
  timestamp: number | null;
  /** ETH the creator spent on the dev buy in the launch transaction. */
  initialBuyEth: bigint;
}

export interface PortfolioTotals {
  /** Priced token holdings only. */
  holdingsValueEth: number;
  /** holdings + WETH + native ETH. */
  totalValueEth: number;
  /** Open cost basis across all holdings. */
  investedEth: number;
  unrealizedPnlEth: number;
  unrealizedPnlPercent: number | null;
  realizedPnlEth: number;
  /** Holdings whose price could not be read; excluded from every total. */
  unpricedCount: number;
  /** True when every holding's balance is fully explained by tracked buys. */
  costBasisComplete: boolean;
}

export interface Portfolio {
  user: Address;
  /** Block the snapshot was taken at. Everything below is confirmed at it. */
  blockNumber: bigint;
  nativeEthBalance: bigint;
  wethBalance: bigint;
  holdings: PortfolioHolding[];
  createdTokens: CreatedToken[];
  trades: PortfolioTrade[];
  totals: PortfolioTotals;
  /** True when the receipt cap truncated the trade history. */
  tradesTruncated: boolean;
}

/* ------------------------------------------------------------------ *
 * FIFO cost basis
 *
 * Lots are consumed oldest first. A buy opens a lot at the ETH-per-token
 * actually paid; a sell closes lots in order and books the difference as
 * realized P&L.
 *
 * A sell can exceed the lots we know about — the wallet may have been minted
 * the tokens as a launch creator, or received them from someone else. Those
 * tokens have no purchase price on this chain, so rather than assume zero
 * (which would book the entire sale as profit) only the covered fraction of
 * the proceeds is booked and the result is flagged incomplete.
 * ------------------------------------------------------------------ */

interface Lot {
  amount: bigint;
  /** ETH paid per whole token. */
  priceEth: number;
}

export interface FifoResult {
  realizedPnlEth: number;
  /** Tokens still held that came from tracked buys. */
  trackedBalance: bigint;
  /** ETH cost of those tokens. */
  costBasisEth: number;
  /** A sell drew on tokens with no known purchase price. */
  incomplete: boolean;
}

/** bigint base units -> float whole tokens. */
function toWhole(amount: bigint, decimals: number): number {
  return Number(amount) / 10 ** decimals;
}

export function fifoCostBasis(
  trades: PortfolioTrade[],
  decimals: number,
): FifoResult {
  // Oldest first; FIFO means nothing in any other order.
  const ordered = [...trades].sort((a, b) =>
    Number(a.blockNumber - b.blockNumber),
  );

  const lots: Lot[] = [];

  let realizedPnlEth = 0;
  let incomplete = false;

  for (const trade of ordered) {
    if (trade.action === "BUY" || trade.action === "DEV_BUY") {
      if (trade.tokenAmount <= 0n || trade.priceEth === null) continue;

      lots.push({ amount: trade.tokenAmount, priceEth: trade.priceEth });
      continue;
    }

    if (trade.action !== "SELL") continue;

    let remaining = trade.tokenAmount;

    const soldWhole = toWhole(trade.tokenAmount, decimals);

    // Proceeds are the ETH actually received, never a modelled price.
    const proceedsEth = Number(trade.ethAmount) / 1e18;

    let costOfSoldEth = 0;
    let coveredWhole = 0;

    while (remaining > 0n && lots.length > 0) {
      const lot = lots[0];
      const take = lot.amount < remaining ? lot.amount : remaining;

      costOfSoldEth += toWhole(take, decimals) * lot.priceEth;
      coveredWhole += toWhole(take, decimals);

      lot.amount -= take;
      remaining -= take;

      if (lot.amount === 0n) lots.shift();
    }

    if (remaining > 0n) {
      incomplete = true;

      const coveredFraction = soldWhole > 0 ? coveredWhole / soldWhole : 0;

      realizedPnlEth += proceedsEth * coveredFraction - costOfSoldEth;
      continue;
    }

    realizedPnlEth += proceedsEth - costOfSoldEth;
  }

  let trackedBalance = 0n;
  let costBasisEth = 0;

  for (const lot of lots) {
    trackedBalance += lot.amount;
    costBasisEth += toWhole(lot.amount, decimals) * lot.priceEth;
  }

  return { realizedPnlEth, trackedBalance, costBasisEth, incomplete };
}

/* ------------------------------------------------------------------ *
 * On-chain collection
 * ------------------------------------------------------------------ */

/**
 * The ETH side of a swap, taken from the pool's own Swap event.
 *
 * Same derivation as getTokenTradeHistory in trade.ts: the token occupies
 * whichever slot the factory reports, so the other amount is the WETH leg.
 * Returns null when the transaction holds no swap on this pool, which is how
 * a plain transfer is told apart from a trade.
 */
function ethLegFromReceipt(
  logs: unknown[],
  pool: Address,
  isToken0: boolean,
): bigint | null {
  const swaps = parseEventLogs({
    abi: UNISWAP_V3_POOL_ABI,
    eventName: "Swap",
    logs: logs as never,
  }).filter((log) => log.address.toLowerCase() === pool.toLowerCase());

  if (!swaps.length) return null;

  const { amount0, amount1 } = swaps[0].args as unknown as {
    amount0: bigint;
    amount1: bigint;
  };

  const delta = isToken0 ? amount1 : amount0;

  return delta < 0n ? -delta : delta;
}

/** Run `work` over `items` with a fixed number in flight. */
async function pooled<T, R>(
  items: T[],
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];

  for (let i = 0; i < items.length; i += CONCURRENCY) {
    out.push(...(await Promise.all(items.slice(i, i + CONCURRENCY).map(work))));
  }

  return out;
}

export interface BuildPortfolioOptions {
  client: PublicClient;
  user: Address;
  /** Cap on transactions whose receipts are fetched for the ETH leg. */
  maxTrades?: number;
  onProgress?: (stage: string) => void;
}

export async function buildPortfolio({
  client,
  user,
  maxTrades = 300,
  onProgress,
}: BuildPortfolioOptions): Promise<Portfolio> {
  // Pin the snapshot to one height so balances, prices and logs agree.
  const head = await client.getBlockNumber();

  const lower = user.toLowerCase();

  onProgress?.("scanning transfers");

  const scanTransfers = (args: Record<string, unknown>) =>
    scanLogs<TransferLog>(client, {
      abi: TRANSFER_ABI as unknown as Abi,
      eventName: "Transfer",
      args,
      fromBlock: SCAN_FLOOR,
      toBlock: head,
    });

  const scanLaunches = (factory: Address, start: bigint) =>
    scanLogs<{
      args: { token: Address; deployer: Address; initialBuyAmount: bigint };
      blockNumber: bigint;
      transactionHash: Hex;
    }>(client, {
      address: factory,
      abi: PONS_FACTORY_ABI as unknown as Abi,
      eventName: "TokenLaunched",
      // `deployer` is indexed, so the node does this filtering for us.
      args: { deployer: user },
      fromBlock: start,
      toBlock: head,
    });

  const [received, sent, launchedActive, launchedLegacy] = await Promise.all([
    scanTransfers({ to: user }),
    scanTransfers({ from: user }),
    scanLaunches(PONS_FACTORY, PONS_FACTORY_START_BLOCK),
    scanLaunches(PONS_LEGACY_FACTORY, PONS_LEGACY_FACTORY_START_BLOCK),
  ]);

  // A self-transfer would appear in both scans; dedupe on log identity.
  const transferKey = (t: TransferLog) =>
    `${t.transactionHash}:${t.address}:${t.args.from}:${t.args.to}:${t.args.value}`;

  const transfers = [...new Map([...received, ...sent].map((t) => [transferKey(t), t])).values()];

  const createdLaunches = [...launchedActive, ...launchedLegacy];

  const createdSet = new Set(
    createdLaunches.map((l) => l.args.token.toLowerCase()),
  );

  /*
   * Created and owned are tracked separately and deliberately: a wallet can
   * hold a token it did not launch, and can launch one it no longer holds.
   * Creation comes only from TokenLaunched(deployer), never from a balance.
   */
  const candidates = [
    ...new Set([...transfers.map((t) => t.address.toLowerCase()), ...createdSet]),
  ].filter((a) => a !== WETH.toLowerCase()) as Address[];

  onProgress?.(`resolving ${candidates.length} tokens`);

  const [nativeEthBalance, wethBalance, launchedInfos, balances, decimalsList] =
    await Promise.all([
      client.getBalance({ address: user, blockNumber: head }),
      client
        .readContract({
          address: WETH,
          abi: PONS_TOKEN_ABI,
          functionName: "balanceOf",
          args: [user],
        })
        .then((b) => b as bigint)
        .catch(() => 0n),
      // These reads all coalesce into Multicall3 via getPonsClient's batching.
      Promise.all(candidates.map((token) => getLaunchedToken(client, token))),
      Promise.all(
        candidates.map((token) =>
          client
            .readContract({
              address: token,
              abi: PONS_TOKEN_ABI,
              functionName: "balanceOf",
              args: [user],
            })
            .then((b) => b as bigint)
            .catch(() => 0n),
        ),
      ),
      Promise.all(
        candidates.map((token) =>
          client
            .readContract({
              address: token,
              abi: PONS_TOKEN_ABI,
              functionName: "decimals",
            })
            .then((d) => Number(d))
            .catch(() => 18),
        ),
      ),
    ]);

  const infoByToken = new Map<string, { info: LaunchedToken; factory: Address }>();
  const balanceByToken = new Map<string, bigint>();
  const decimalsByToken = new Map<string, number>();

  candidates.forEach((token, i) => {
    const key = token.toLowerCase();

    if (launchedInfos[i]) infoByToken.set(key, launchedInfos[i]!);

    balanceByToken.set(key, balances[i]);
    decimalsByToken.set(key, decimalsList[i]);
  });

  // Only Pons tokens have a pool this app knows how to price.
  const ponsTokens = candidates.filter((t) => infoByToken.has(t.toLowerCase()));

  onProgress?.("pricing");

  const [summaries, pools] = await Promise.all([
    ponsTokens.length ? getTokenSummaries(client, ponsTokens) : [],
    Promise.all(
      ponsTokens.map((token) =>
        client
          .readContract({
            address: token,
            abi: PONS_TOKEN_ABI,
            functionName: "liquidityPool",
          })
          .then((p) => p as Address)
          .catch(() => null),
      ),
    ),
  ]);

  const summaryByToken = new Map<string, TokenSummary>(
    summaries.map((s) => [s.token.toLowerCase(), s]),
  );

  const poolByToken = new Map<string, Address>();

  ponsTokens.forEach((token, i) => {
    const pool = pools[i];

    if (pool) poolByToken.set(token.toLowerCase(), pool);
  });

  onProgress?.("correlating trades");

  /*
   * A transfer is a candidate trade only when the counterparty is the token's
   * own pool. Wallet-to-wallet sends are kept as TRANSFER_IN/OUT so activity
   * stays honest about them, but they never contribute a cost basis.
   */
  interface Candidate {
    log: TransferLog;
    pool: Address;
    isToken0: boolean;
    isBuy: boolean;
  }

  const candidateTrades: Candidate[] = [];
  const plainTransfers: PortfolioTrade[] = [];

  const symbolOf = (token: string) => summaryByToken.get(token)?.symbol ?? "";

  for (const log of transfers) {
    const token = log.address.toLowerCase();

    if (token === WETH.toLowerCase()) continue;

    const isIn = log.args.to.toLowerCase() === lower;
    const found = infoByToken.get(token);
    const pool = poolByToken.get(token);

    const from = log.args.from.toLowerCase();
    const to = log.args.to.toLowerCase();

    /*
     * A swap can reach the wallet either straight from the pool or via
     * SwapRouter02, which holds the tokens mid-route when a leg needs
     * unwrapping. Both count as candidates; the Swap event in the receipt is
     * what actually confirms a trade below, so a router transfer that turns
     * out not to be a swap is downgraded rather than mis-booked.
     */
    const tradeCounterparty =
      (pool !== undefined && (from === pool.toLowerCase() || to === pool.toLowerCase())) ||
      from === SWAP_ROUTER.toLowerCase() ||
      to === SWAP_ROUTER.toLowerCase();

    if (!found || pool === undefined || !tradeCounterparty) {
      // Tokens out of the Pons locker are LP trading fees on a launch this
      // wallet created. Real income, but not a purchase: it has no ETH cost,
      // so it must never open a cost-basis lot.
      const isFeeClaim = isIn && from === PONS_LOCKER.toLowerCase();

      plainTransfers.push({
        transactionHash: log.transactionHash,
        blockNumber: log.blockNumber,
        timestamp: null,
        token: log.address,
        symbol: symbolOf(token),
        action: isFeeClaim ? "FEE_CLAIM" : isIn ? "TRANSFER_IN" : "TRANSFER_OUT",
        tokenAmount: log.args.value,
        ethAmount: 0n,
        priceEth: null,
      });

      continue;
    }

    candidateTrades.push({
      log,
      pool: pool!,
      isToken0: found.info.isToken0,
      isBuy: isIn,
    });
  }

  // Newest first, then cap: a wallet with thousands of trades must not turn
  // one page load into thousands of receipt fetches.
  candidateTrades.sort((a, b) =>
    Number(b.log.blockNumber - a.log.blockNumber),
  );

  const tradesTruncated = candidateTrades.length > maxTrades;
  const capped = candidateTrades.slice(0, maxTrades);

  // One receipt per transaction, however many transfers it produced.
  const receiptByHash = new Map<Hex, { logs: unknown[] } | null>();

  const uniqueHashes = [...new Set(capped.map((c) => c.log.transactionHash))];

  const receipts = await pooled(uniqueHashes, (hash) =>
    client.getTransactionReceipt({ hash }).catch(() => null),
  );

  uniqueHashes.forEach((hash, i) => {
    receiptByHash.set(hash, receipts[i] as { logs: unknown[] } | null);
  });

  const launchTxByToken = new Map<string, Hex>(
    createdLaunches.map((l) => [l.args.token.toLowerCase(), l.transactionHash]),
  );

  const trades: PortfolioTrade[] = [];

  for (const c of capped) {
    const receipt = receiptByHash.get(c.log.transactionHash);

    const token = c.log.address.toLowerCase();
    const decimals = decimalsByToken.get(token) ?? 18;

    const ethAmount = receipt
      ? ethLegFromReceipt(receipt.logs, c.pool, c.isToken0)
      : null;

    if (ethAmount === null) {
      // Touched the pool but produced no swap on it — a liquidity operation,
      // not a trade. Recorded, but never priced or counted as a buy/sell.
      plainTransfers.push({
        transactionHash: c.log.transactionHash,
        blockNumber: c.log.blockNumber,
        timestamp: null,
        token: c.log.address,
        symbol: symbolOf(token),
        action:
          c.isBuy && c.log.args.from.toLowerCase() === PONS_LOCKER.toLowerCase()
            ? "FEE_CLAIM"
            : c.isBuy
              ? "TRANSFER_IN"
              : "TRANSFER_OUT",
        tokenAmount: c.log.args.value,
        ethAmount: 0n,
        priceEth: null,
      });

      continue;
    }

    const tokenWhole = toWhole(c.log.args.value, decimals);

    const isDevBuy =
      c.isBuy && launchTxByToken.get(token) === c.log.transactionHash;

    trades.push({
      transactionHash: c.log.transactionHash,
      blockNumber: c.log.blockNumber,
      timestamp: null,
      token: c.log.address,
      symbol: symbolOf(token),
      action: isDevBuy ? "DEV_BUY" : c.isBuy ? "BUY" : "SELL",
      tokenAmount: c.log.args.value,
      ethAmount,
      priceEth:
        tokenWhole > 0 ? Number(ethAmount) / 1e18 / tokenWhole : null,
    });
  }

  // Creation rows, so activity shows the launch itself and not only its buy.
  const createRows: PortfolioTrade[] = createdLaunches.map((l) => ({
    transactionHash: l.transactionHash,
    blockNumber: l.blockNumber,
    timestamp: null,
    token: l.args.token,
    symbol: symbolOf(l.args.token.toLowerCase()),
    action: "CREATE" as const,
    tokenAmount: 0n,
    ethAmount: l.args.initialBuyAmount,
    priceEth: null,
  }));

  const allActivity = [...trades, ...plainTransfers, ...createRows].sort((a, b) =>
    Number(b.blockNumber - a.blockNumber),
  );

  onProgress?.("timestamps");

  const timestamps = await (async () => {
    const blocks = [...new Set(allActivity.map((t) => t.blockNumber))];

    const results = await pooled(blocks, (blockNumber) =>
      client.getBlock({ blockNumber }).catch(() => null),
    );

    const map = new Map<bigint, number>();

    blocks.forEach((b, i) => {
      const block = results[i];

      if (block) map.set(b, Number(block.timestamp));
    });

    return map;
  })();

  for (const entry of allActivity) {
    entry.timestamp = timestamps.get(entry.blockNumber) ?? null;
  }

  /* ---------------------------------------------------------------- *
   * Holdings and P&L
   * ---------------------------------------------------------------- */

  const tradesByToken = new Map<string, PortfolioTrade[]>();

  for (const trade of trades) {
    const key = trade.token.toLowerCase();

    tradesByToken.set(key, [...(tradesByToken.get(key) ?? []), trade]);
  }

  const holdings: PortfolioHolding[] = [];

  for (const token of candidates) {
    const key = token.toLowerCase();

    const balance = balanceByToken.get(key) ?? 0n;
    const tokenTrades = tradesByToken.get(key) ?? [];

    // Keep a token the wallet has traded or created even at zero balance —
    // its realized P&L still belongs in the totals — but drop dust-free
    // tokens it neither holds nor ever traded.
    if (balance === 0n && tokenTrades.length === 0 && !createdSet.has(key)) {
      continue;
    }

    const decimals = decimalsByToken.get(key) ?? 18;
    const summary = summaryByToken.get(key);

    const fifo = fifoCostBasis(tokenTrades, decimals);

    const priceEth = summary ? summary.priceEth : null;

    const balanceWhole = toWhole(balance, decimals);
    const trackedWhole = toWhole(fifo.trackedBalance, decimals);

    const valueEth = priceEth === null ? null : priceEth * balanceWhole;

    // Unrealized P&L covers only the tokens whose purchase price we know.
    const trackedValueEth = priceEth === null ? null : priceEth * trackedWhole;

    const unrealizedPnlEth =
      trackedValueEth === null || fifo.trackedBalance === 0n
        ? null
        : trackedValueEth - fifo.costBasisEth;

    const untrackedBalance =
      balance > fifo.trackedBalance ? balance - fifo.trackedBalance : 0n;

    holdings.push({
      token,
      name: summary?.name ?? "",
      symbol: summary?.symbol ?? "",
      logo: summary?.logo ?? "",
      decimals,
      balance,
      priceEth,
      valueEth,
      costBasisEth: fifo.costBasisEth,
      trackedBalance: fifo.trackedBalance,
      untrackedBalance,
      avgBuyPriceEth:
        trackedWhole > 0 ? fifo.costBasisEth / trackedWhole : null,
      unrealizedPnlEth,
      unrealizedPnlPercent:
        unrealizedPnlEth === null || fifo.costBasisEth <= 0
          ? null
          : (unrealizedPnlEth / fifo.costBasisEth) * 100,
      realizedPnlEth: fifo.realizedPnlEth,
      marketCapEth: summary?.marketCapEth ?? null,
      graduated: summary?.graduated ?? false,
      graduationProgress: summary?.graduationProgress ?? 0,
      isCreatedByUser: createdSet.has(key),
      costBasisComplete: !fifo.incomplete && untrackedBalance === 0n,
    });
  }

  holdings.sort((a, b) => (b.valueEth ?? -1) - (a.valueEth ?? -1));

  const createdTokens: CreatedToken[] = createdLaunches
    .map((l) => {
      const key = l.args.token.toLowerCase();
      const summary = summaryByToken.get(key);

      return {
        token: l.args.token,
        name: summary?.name ?? "",
        symbol: summary?.symbol ?? "",
        logo: summary?.logo ?? "",
        priceEth: summary?.priceEth ?? null,
        marketCapEth: summary?.marketCapEth ?? null,
        liquidityEth:
          summary === undefined
            ? null
            : Number(summary.pairedPrincipal) / 1e18,
        graduated: summary?.graduated ?? false,
        graduationProgress: summary?.graduationProgress ?? 0,
        balance: balanceByToken.get(key) ?? 0n,
        transactionHash: l.transactionHash,
        blockNumber: l.blockNumber,
        timestamp: timestamps.get(l.blockNumber) ?? null,
        initialBuyEth: l.args.initialBuyAmount,
      };
    })
    .sort((a, b) => Number(b.blockNumber - a.blockNumber));

  /* ---------------------------------------------------------------- *
   * Totals
   *
   * Unpriced holdings are excluded from value rather than counted as zero,
   * so a token with no readable pool cannot silently deflate the portfolio.
   * ---------------------------------------------------------------- */

  const holdingsValueEth = holdings.reduce(
    (sum, h) => sum + (h.valueEth ?? 0),
    0,
  );

  const investedEth = holdings.reduce((sum, h) => sum + h.costBasisEth, 0);

  const unrealizedPnlEth = holdings.reduce(
    (sum, h) => sum + (h.unrealizedPnlEth ?? 0),
    0,
  );

  const realizedPnlEth = holdings.reduce((sum, h) => sum + h.realizedPnlEth, 0);

  const wethEth = Number(wethBalance) / 1e18;
  const nativeEth = Number(nativeEthBalance) / 1e18;

  return {
    user,
    blockNumber: head,
    nativeEthBalance,
    wethBalance,
    holdings,
    createdTokens,
    trades: allActivity,
    tradesTruncated,
    totals: {
      holdingsValueEth,
      totalValueEth: holdingsValueEth + wethEth + nativeEth,
      investedEth,
      unrealizedPnlEth,
      unrealizedPnlPercent:
        investedEth > 0 ? (unrealizedPnlEth / investedEth) * 100 : null,
      realizedPnlEth,
      unpricedCount: holdings.filter((h) => h.priceEth === null).length,
      costBasisComplete: holdings.every((h) => h.costBasisComplete),
    },
  };
}
