"use client";

import { useMemo, useState } from "react";

import Link from "next/link";
import {
  AlertTriangle,
  ExternalLink,
  RefreshCw,
  Rocket,
  Wallet,
} from "lucide-react";

import EvmWalletButton from "../components/EvmWalletButton";
import TokenLogo from "../components/TokenLogo";

import { explorerTokenUrl, explorerTxUrl } from "../src/lib/pons/chain";
import { PAGE_CONTAINER } from "../src/ui";

import {
  usePortfolio,
  type CreatedRow,
  type HoldingRow,
  type TradeRow,
} from "../src/hooks/usePortfolio";

/*
 * Portfolio for the connected wallet.
 *
 * Every number on this page is derived in app/src/lib/pons/portfolio.ts from
 * confirmed chain state; nothing here computes value or P&L itself. Values are
 * denominated in ETH because the project has no fiat price source — see the
 * note at the top of portfolio.ts.
 */

/* ------------------------------------------------------------------ *
 * Formatting
 *
 * A price can be 1e-9 ETH and a balance 30,000,000 tokens, so fixed decimal
 * places are useless at both ends. These pick a representation per magnitude
 * and never round a non-zero value down to a flat "0".
 * ------------------------------------------------------------------ */

function formatEth(value: number | null, places = 4): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (value === 0) return "0";

  const abs = Math.abs(value);

  if (abs < 1e-6) return value.toExponential(2);
  if (abs < 0.0001) return value.toFixed(8);
  if (abs < 1) return value.toFixed(6);

  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: places,
  });
}

function formatPrice(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (value === 0) return "0";

  return value.toExponential(3);
}

function formatUnits(raw: string, decimals: number): string {
  const value = Number(raw) / 10 ** decimals;

  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  if (value < 0.0001) return value.toExponential(2);

  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";

  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function timeAgo(timestamp: number | null): string {
  if (!timestamp) return "—";

  const seconds = Math.floor(Date.now() / 1000) - timestamp;

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 2592000) return `${Math.floor(seconds / 86400)}d ago`;

  return new Date(timestamp * 1000).toLocaleDateString();
}

function shorten(value: string): string {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function pnlClass(value: number | null): string {
  if (value === null || value === 0) return "text-zinc-300";

  return value > 0 ? "text-emerald-400" : "text-red-400";
}

/* ------------------------------------------------------------------ *
 * Shared pieces
 * ------------------------------------------------------------------ */

function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-white/[0.08] bg-white/[0.02] ${className}`}
    >
      {children}
    </div>
  );
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-white/[0.07] ${className}`} />;
}

function SectionHeading({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">
        {title}
        {count !== undefined && (
          <span className="ml-2 text-sm font-normal text-zinc-600">{count}</span>
        )}
      </h2>

      {children}
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <Card className="px-6 py-12 text-center text-sm text-zinc-500">
      {children}
    </Card>
  );
}

function TokenIdentity({
  logo,
  symbol,
  name,
  token,
}: {
  logo: string;
  symbol: string;
  name: string;
  token: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <TokenLogo logo={logo} symbol={symbol} alt={name || symbol} />

      <div className="min-w-0">
        <Link
          href={`/pons/${token}`}
          className="block truncate font-semibold hover:text-violet-300"
        >
          {symbol || shorten(token)}
        </Link>

        <p className="truncate text-xs text-zinc-500">
          {name || "Unknown token"}
        </p>
      </div>
    </div>
  );
}

/** Flags a holding whose balance is not fully explained by tracked buys. */
function IncompleteBadge({ holding }: { holding: HoldingRow }) {
  if (holding.costBasisComplete) return null;

  return (
    <span
      title="Part of this balance arrived by mint, airdrop, LP fee or transfer, so it has no purchase price on-chain. It is counted in value but excluded from cost basis and P&L."
      className="ml-2 inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300"
    >
      <AlertTriangle size={9} />
      partial
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Summary
 * ------------------------------------------------------------------ */

function SummaryTile({
  label,
  value,
  sub,
  loading,
  valueClass = "",
}: {
  label: string;
  value: string;
  sub?: string;
  loading: boolean;
  valueClass?: string;
}) {
  return (
    <Card className="p-5">
      <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
        {label}
      </p>

      {loading ? (
        <>
          <Skeleton className="mt-3 h-7 w-32" />
          <Skeleton className="mt-2 h-3 w-20" />
        </>
      ) : (
        <>
          <p
            className={`mt-2 text-2xl font-bold tracking-tight ${valueClass}`}
          >
            {value}
          </p>

          {sub && <p className="mt-1 text-xs text-zinc-500">{sub}</p>}
        </>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * Holdings
 * ------------------------------------------------------------------ */

const HOLDING_COLUMNS = [
  "Token",
  "Balance",
  "Avg buy",
  "Current",
  "Value",
  "Invested",
  "Unrealized P&L",
];

function HoldingRowDesktop({ holding }: { holding: HoldingRow }) {
  return (
    <tr className="border-t border-white/[0.06]">
      <td className="px-4 py-3">
        <div className="flex items-center">
          <TokenIdentity
            logo={holding.logo}
            symbol={holding.symbol}
            name={holding.name}
            token={holding.token}
          />

          <IncompleteBadge holding={holding} />
        </div>
      </td>

      <td className="px-4 py-3 text-right tabular-nums">
        {formatUnits(holding.balance, holding.decimals)}
      </td>

      <td className="px-4 py-3 text-right tabular-nums text-zinc-400">
        {formatPrice(holding.avgBuyPriceEth)}
      </td>

      <td className="px-4 py-3 text-right tabular-nums">
        {formatPrice(holding.priceEth)}
      </td>

      <td className="px-4 py-3 text-right font-semibold tabular-nums">
        {holding.valueEth === null ? (
          <span className="text-zinc-600" title="No readable pool price">
            N/A
          </span>
        ) : (
          formatEth(holding.valueEth)
        )}
      </td>

      <td className="px-4 py-3 text-right tabular-nums text-zinc-400">
        {holding.costBasisEth > 0 ? formatEth(holding.costBasisEth) : "—"}
      </td>

      <td className="px-4 py-3 text-right tabular-nums">
        <span className={pnlClass(holding.unrealizedPnlEth)}>
          {holding.unrealizedPnlEth === null
            ? "—"
            : `${holding.unrealizedPnlEth >= 0 ? "+" : ""}${formatEth(holding.unrealizedPnlEth)}`}
        </span>

        <span className="ml-2 text-xs text-zinc-500">
          {formatPercent(holding.unrealizedPnlPercent)}
        </span>
      </td>
    </tr>
  );
}

function HoldingCardMobile({ holding }: { holding: HoldingRow }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <TokenIdentity
          logo={holding.logo}
          symbol={holding.symbol}
          name={holding.name}
          token={holding.token}
        />

        <div className="shrink-0 text-right">
          <p className="font-semibold tabular-nums">
            {holding.valueEth === null ? (
              <span className="text-zinc-600">N/A</span>
            ) : (
              `${formatEth(holding.valueEth)} ETH`
            )}
          </p>

          <p className={`text-xs tabular-nums ${pnlClass(holding.unrealizedPnlEth)}`}>
            {holding.unrealizedPnlEth === null
              ? "—"
              : `${holding.unrealizedPnlEth >= 0 ? "+" : ""}${formatEth(holding.unrealizedPnlEth)} (${formatPercent(holding.unrealizedPnlPercent)})`}
          </p>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <div className="flex justify-between">
          <dt className="text-zinc-500">Balance</dt>
          <dd className="tabular-nums">
            {formatUnits(holding.balance, holding.decimals)}
          </dd>
        </div>

        <div className="flex justify-between">
          <dt className="text-zinc-500">Invested</dt>
          <dd className="tabular-nums">
            {holding.costBasisEth > 0 ? formatEth(holding.costBasisEth) : "—"}
          </dd>
        </div>

        <div className="flex justify-between">
          <dt className="text-zinc-500">Avg buy</dt>
          <dd className="tabular-nums">{formatPrice(holding.avgBuyPriceEth)}</dd>
        </div>

        <div className="flex justify-between">
          <dt className="text-zinc-500">Current</dt>
          <dd className="tabular-nums">{formatPrice(holding.priceEth)}</dd>
        </div>
      </dl>

      {!holding.costBasisComplete && (
        <p className="mt-3 flex items-start gap-1.5 text-[11px] text-amber-300/80">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" />
          Part of this balance has no on-chain purchase price, so it is excluded
          from cost basis.
        </p>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * Created tokens
 * ------------------------------------------------------------------ */

function CreatedCard({ created }: { created: CreatedRow }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <TokenIdentity
          logo={created.logo}
          symbol={created.symbol}
          name={created.name}
          token={created.token}
        />

        {created.graduated ? (
          <span className="shrink-0 rounded-full bg-yellow-400/10 px-2 py-0.5 text-[11px] font-medium text-yellow-400">
            Graduated
          </span>
        ) : (
          <span className="shrink-0 rounded-full bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-300">
            {(created.graduationProgress * 100).toFixed(1)}% bonded
          </span>
        )}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <div className="flex justify-between">
          <dt className="text-zinc-500">Price</dt>
          <dd className="tabular-nums">{formatPrice(created.priceEth)}</dd>
        </div>

        <div className="flex justify-between">
          <dt className="text-zinc-500">Market cap</dt>
          <dd className="tabular-nums">{formatEth(created.marketCapEth)}</dd>
        </div>

        <div className="flex justify-between">
          <dt className="text-zinc-500">Liquidity</dt>
          <dd className="tabular-nums">{formatEth(created.liquidityEth)}</dd>
        </div>

        <div className="flex justify-between">
          <dt className="text-zinc-500">You hold</dt>
          <dd className="tabular-nums">{formatUnits(created.balance, 18)}</dd>
        </div>

        <div className="flex justify-between">
          <dt className="text-zinc-500">Dev buy</dt>
          <dd className="tabular-nums">
            {formatEth(Number(created.initialBuyEth) / 1e18)} ETH
          </dd>
        </div>

        <div className="flex justify-between">
          <dt className="text-zinc-500">Created</dt>
          <dd>{timeAgo(created.timestamp)}</dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-[11px]">
        <a
          href={explorerTokenUrl(created.token)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-zinc-500 hover:text-zinc-300"
        >
          <span className="font-mono">{shorten(created.token)}</span>
          <ExternalLink size={10} />
        </a>

        <a
          href={explorerTxUrl(created.transactionHash)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-zinc-500 hover:text-zinc-300"
        >
          launch tx
          <ExternalLink size={10} />
        </a>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * Activity
 * ------------------------------------------------------------------ */

const ACTION_STYLE: Record<string, string> = {
  BUY: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  DEV_BUY: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  SELL: "border-red-500/30 bg-red-500/10 text-red-300",
  CREATE: "border-violet-500/30 bg-violet-500/10 text-violet-300",
  FEE_CLAIM: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  TRANSFER_IN: "border-white/10 bg-white/[0.04] text-zinc-400",
  TRANSFER_OUT: "border-white/10 bg-white/[0.04] text-zinc-400",
};

const ACTION_LABEL: Record<string, string> = {
  BUY: "Buy",
  DEV_BUY: "Dev buy",
  SELL: "Sell",
  CREATE: "Created",
  FEE_CLAIM: "LP fees",
  TRANSFER_IN: "Received",
  TRANSFER_OUT: "Sent",
};

function ActionTag({ action }: { action: string }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        ACTION_STYLE[action] ?? ACTION_STYLE.TRANSFER_IN
      }`}
    >
      {ACTION_LABEL[action] ?? action}
    </span>
  );
}

function TradeRowView({ trade }: { trade: TradeRow }) {
  const hasEth = trade.ethAmount !== "0";

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/[0.06] px-4 py-3 text-sm">
      <div className="w-20 shrink-0">
        <ActionTag action={trade.action} />
      </div>

      <Link
        href={`/pons/${trade.token}`}
        className="w-24 shrink-0 truncate font-medium hover:text-violet-300"
      >
        {trade.symbol || shorten(trade.token)}
      </Link>

      <span className="w-36 shrink-0 tabular-nums text-zinc-300">
        {trade.action === "CREATE"
          ? "—"
          : formatUnits(trade.tokenAmount, 18)}
      </span>

      <span className="w-28 shrink-0 tabular-nums text-zinc-400">
        {hasEth ? `${formatEth(Number(trade.ethAmount) / 1e18)} ETH` : "—"}
      </span>

      <span className="w-24 shrink-0 tabular-nums text-zinc-500">
        {formatPrice(trade.priceEth)}
      </span>

      <span className="ml-auto flex items-center gap-3 text-xs text-zinc-500">
        {timeAgo(trade.timestamp)}

        <a
          href={explorerTxUrl(trade.transactionHash)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-mono hover:text-zinc-300"
        >
          {shorten(trade.transactionHash)}
          <ExternalLink size={10} />
        </a>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Page
 * ------------------------------------------------------------------ */

const ACTIVITY_PAGE = 25;

export default function PortfolioPage() {
  const {
    address,
    isConnected,
    isConnecting,
    portfolio,
    updatedAt,
    stale,
    isLoading,
    isFetching,
    error,
    refresh,
  } = usePortfolio();

  const [visibleTrades, setVisibleTrades] = useState(ACTIVITY_PAGE);

  const totals = portfolio?.totals ?? null;

  const wethEth = useMemo(
    () => (portfolio ? Number(portfolio.wethBalance) / 1e18 : 0),
    [portfolio],
  );

  const nativeEth = useMemo(
    () => (portfolio ? Number(portfolio.nativeEthBalance) / 1e18 : 0),
    [portfolio],
  );

  /* ---------------- wallet not connected ---------------- */

  if (!isConnected && !isConnecting) {
    return (
      <main className="min-h-screen bg-[#05070b] text-white">
        <div className={PAGE_CONTAINER}>
          <h1 className="text-3xl font-bold tracking-tight">Portfolio</h1>

          <Card className="mt-10 flex flex-col items-center gap-4 px-6 py-20 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/[0.04]">
              <Wallet size={20} className="text-zinc-500" />
            </div>

            <p className="text-zinc-400">
              Connect your wallet to view your portfolio.
            </p>

            <EvmWalletButton />
          </Card>
        </div>
      </main>
    );
  }

  const loading = isConnecting || isLoading || (isFetching && !portfolio);

  /*
   * The whole-page empty state is for a wallet that holds literally nothing.
   * Native ETH counts: without it a gas-only wallet showed a non-zero total
   * value directly above the words "your portfolio is empty". Anything less
   * than untouched falls through to the per-section empty states instead.
   */
  const isEmpty =
    portfolio !== null &&
    portfolio.holdings.length === 0 &&
    portfolio.createdTokens.length === 0 &&
    portfolio.trades.length === 0 &&
    portfolio.wethBalance === "0" &&
    portfolio.nativeEthBalance === "0";

  return (
    <main className="min-h-screen bg-[#05070b] text-white">
      <div className={PAGE_CONTAINER}>
        {/* ---------------- header ---------------- */}

        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-3xl font-bold tracking-tight">Portfolio</h1>

            <p className="mt-2 text-sm text-zinc-400">
              {address ? (
                <span className="font-mono">{shorten(address)}</span>
              ) : (
                "Connecting..."
              )}

              <span className="mx-2 text-zinc-700">·</span>

              <span>All values in ETH</span>
            </p>

            {portfolio && (
              <p className="mt-1 text-xs text-zinc-600">
                Confirmed at block {portfolio.blockNumber}
                {updatedAt && ` · updated ${timeAgo(Math.floor(updatedAt / 1000))}`}
                {stale && " · showing last good snapshot"}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={refresh}
              disabled={isFetching}
              className="flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-xs font-medium text-zinc-300 transition hover:border-white/20 disabled:opacity-40"
            >
              <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
              Refresh
            </button>

            <EvmWalletButton />
          </div>
        </div>

        {/* ---------------- error ---------------- */}

        {error && !portfolio && (
          <Card className="mb-8 flex flex-wrap items-center justify-between gap-4 border-red-500/30 bg-red-500/10 px-5 py-4">
            <p className="text-sm text-red-300">{error}</p>

            <button
              onClick={refresh}
              disabled={isFetching}
              className="flex h-8 items-center gap-2 rounded-lg border border-red-400/30 px-3 text-xs font-semibold text-red-200 transition hover:bg-red-500/10 disabled:opacity-40"
            >
              <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} />
              Retry
            </button>
          </Card>
        )}

        {/* ---------------- summary ---------------- */}

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <SummaryTile
            label="Total value"
            loading={loading}
            value={`${formatEth(totals?.totalValueEth ?? null)} ETH`}
            sub={
              totals
                ? `${formatEth(totals.holdingsValueEth)} tokens · ${formatEth(wethEth + nativeEth)} ETH+WETH`
                : undefined
            }
          />

          <SummaryTile
            label="Invested"
            loading={loading}
            value={`${formatEth(totals?.investedEth ?? null)} ETH`}
            sub="Open cost basis (FIFO)"
          />

          <SummaryTile
            label="Unrealized P&L"
            loading={loading}
            valueClass={pnlClass(totals?.unrealizedPnlEth ?? null)}
            value={
              totals
                ? `${totals.unrealizedPnlEth >= 0 ? "+" : ""}${formatEth(totals.unrealizedPnlEth)} ETH`
                : "—"
            }
            sub={totals ? formatPercent(totals.unrealizedPnlPercent) : undefined}
          />

          <SummaryTile
            label="Realized P&L"
            loading={loading}
            valueClass={pnlClass(totals?.realizedPnlEth ?? null)}
            value={
              totals
                ? `${totals.realizedPnlEth >= 0 ? "+" : ""}${formatEth(totals.realizedPnlEth)} ETH`
                : "—"
            }
            sub="From closed FIFO lots"
          />
        </div>

        {/* ---------------- base assets ---------------- */}

        <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <SummaryTile
            label="WETH balance"
            loading={loading}
            value={portfolio ? formatEth(wethEth, 6) : "—"}
            sub={portfolio ? `${formatEth(wethEth)} ETH value` : undefined}
          />

          <SummaryTile
            label="Native ETH"
            loading={loading}
            value={portfolio ? formatEth(nativeEth, 6) : "—"}
            sub="Gas balance"
          />
        </div>

        {/* Anything the chain could not fully explain is said out loud rather
            than folded silently into the totals above. */}
        {totals && (totals.unpricedCount > 0 || !totals.costBasisComplete) && (
          <p className="mt-4 flex items-start gap-2 text-xs text-amber-300/80">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />

            <span>
              {totals.unpricedCount > 0 &&
                `${totals.unpricedCount} holding${totals.unpricedCount === 1 ? "" : "s"} had no readable pool price and ${totals.unpricedCount === 1 ? "is" : "are"} excluded from every total. `}

              {!totals.costBasisComplete &&
                "Some tokens arrived by mint, LP fee or transfer with no on-chain purchase price, so they count toward value but not toward cost basis or P&L."}
            </span>
          </p>
        )}

        {/* ---------------- empty portfolio ---------------- */}

        {isEmpty && !loading ? (
          <div className="mt-10">
            <EmptyState>
              <p className="text-zinc-400">Your portfolio is empty.</p>

              <p className="mt-1">
                Start trading or create a token to get started.
              </p>

              <div className="mt-6 flex justify-center gap-3">
                <Link
                  href="/pons"
                  className="flex h-9 items-center rounded-lg border border-white/10 bg-white/[0.03] px-4 text-xs font-semibold text-zinc-300 transition hover:border-white/20"
                >
                  Browse market
                </Link>

                <Link
                  href="/pons/launch"
                  className="flex h-9 items-center gap-2 rounded-lg border border-violet-500/30 bg-violet-500/10 px-4 text-xs font-semibold text-violet-300 transition hover:bg-violet-500/20"
                >
                  <Rocket size={13} />
                  Launch a token
                </Link>
              </div>
            </EmptyState>
          </div>
        ) : (
          <>
            {/* ---------------- holdings ---------------- */}

            <section className="mt-12">
              <SectionHeading
                title="My holdings"
                count={portfolio?.holdings.length}
              />

              {loading ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-20 w-full rounded-2xl" />
                  ))}
                </div>
              ) : !portfolio || portfolio.holdings.length === 0 ? (
                <EmptyState>No tokens in your portfolio yet.</EmptyState>
              ) : (
                <>
                  {/* Table on desktop, cards on mobile — a 7-column table has
                      nowhere to go on a phone. */}
                  <Card className="hidden overflow-x-auto md:block">
                    <table className="w-full min-w-[820px] text-sm">
                      <thead>
                        <tr className="text-xs uppercase tracking-wider text-zinc-500">
                          {HOLDING_COLUMNS.map((column, i) => (
                            <th
                              key={column}
                              className={`px-4 py-3 font-medium ${i === 0 ? "text-left" : "text-right"}`}
                            >
                              {column}
                            </th>
                          ))}
                        </tr>
                      </thead>

                      <tbody>
                        {portfolio.holdings.map((holding) => (
                          <HoldingRowDesktop
                            key={holding.token}
                            holding={holding}
                          />
                        ))}
                      </tbody>
                    </table>
                  </Card>

                  <div className="space-y-3 md:hidden">
                    {portfolio.holdings.map((holding) => (
                      <HoldingCardMobile key={holding.token} holding={holding} />
                    ))}
                  </div>
                </>
              )}
            </section>

            {/* ---------------- created ---------------- */}

            <section className="mt-12">
              <SectionHeading
                title="My created tokens"
                count={portfolio?.createdTokens.length}
              />

              {loading ? (
                <div className="grid gap-4 md:grid-cols-2">
                  {Array.from({ length: 2 }).map((_, i) => (
                    <Skeleton key={i} className="h-56 w-full rounded-2xl" />
                  ))}
                </div>
              ) : !portfolio || portfolio.createdTokens.length === 0 ? (
                <EmptyState>
                  <p>You haven&apos;t created any tokens yet.</p>

                  <Link
                    href="/pons/launch"
                    className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg border border-violet-500/30 bg-violet-500/10 px-4 text-xs font-semibold text-violet-300 transition hover:bg-violet-500/20"
                  >
                    <Rocket size={13} />
                    Launch a token
                  </Link>
                </EmptyState>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {portfolio.createdTokens.map((created) => (
                    <CreatedCard key={created.token} created={created} />
                  ))}
                </div>
              )}
            </section>

            {/* ---------------- activity ---------------- */}

            <section className="mt-12">
              <SectionHeading
                title="Trading activity"
                count={portfolio?.trades.length}
              />

              {loading ? (
                <Skeleton className="h-64 w-full rounded-2xl" />
              ) : !portfolio || portfolio.trades.length === 0 ? (
                <EmptyState>No trading activity yet.</EmptyState>
              ) : (
                <>
                  <Card className="overflow-x-auto">
                    <div className="min-w-[720px]">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-xs uppercase tracking-wider text-zinc-500">
                        <span className="w-20 shrink-0">Action</span>
                        <span className="w-24 shrink-0">Token</span>
                        <span className="w-36 shrink-0">Tokens</span>
                        <span className="w-28 shrink-0">ETH</span>
                        <span className="w-24 shrink-0">Price</span>
                        <span className="ml-auto">When / tx</span>
                      </div>

                      {portfolio.trades.slice(0, visibleTrades).map((trade) => (
                        <TradeRowView
                          key={`${trade.transactionHash}-${trade.token}-${trade.action}-${trade.tokenAmount}`}
                          trade={trade}
                        />
                      ))}
                    </div>
                  </Card>

                  {portfolio.trades.length > visibleTrades && (
                    <button
                      onClick={() =>
                        setVisibleTrades((n) => n + ACTIVITY_PAGE)
                      }
                      className="mx-auto mt-4 flex h-9 items-center rounded-lg border border-white/10 bg-white/[0.03] px-4 text-xs font-medium text-zinc-300 transition hover:border-white/20"
                    >
                      Show more ({portfolio.trades.length - visibleTrades} left)
                    </button>
                  )}

                  {portfolio.tradesTruncated && (
                    <p className="mt-3 flex items-start gap-2 text-xs text-amber-300/80">
                      <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                      This wallet has more trades than one scan retrieves, so
                      the oldest are missing and P&amp;L covers only what is
                      shown.
                    </p>
                  )}
                </>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
