"use client";

import { useState } from "react";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Rocket, RefreshCw, TrendingUp } from "lucide-react";

import EvmWalletButton from "../components/EvmWalletButton";
import TokenLogo from "../components/TokenLogo";

import { PAGE_CONTAINER } from "../src/ui";

interface Summary {
  token: string;
  name: string;
  symbol: string;
  logo: string;
  priceEth: number;
  marketCapEth: number;
  graduated: boolean;
  graduationProgress: number;
}

interface LaunchRow {
  token: string;
  deployer: string;
  blockNumber: string;
}

function TokenCard({ summary }: { summary: Summary }) {
  return (
    <Link
      href={`/pons/${summary.token}`}
      className="group overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02] transition hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.04]"
    >
      <div className="relative aspect-square overflow-hidden bg-white/[0.03]">
        <TokenLogo
          logo={summary.logo}
          symbol={summary.symbol}
          alt={summary.name}
          sizeClass="h-full w-full"
          rounded="rounded-none"
        />

        <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-zinc-300 backdrop-blur">
          {summary.symbol}
        </span>
      </div>

      <div className="p-4">
        <p className="truncate font-semibold">{summary.name}</p>

        <p className="mt-0.5 truncate text-xs text-zinc-500">
          {summary.token.slice(0, 6)}...{summary.token.slice(-4)}
        </p>

        <div className="mt-3 flex items-center justify-between">
          {summary.graduated ? (
            <span className="rounded-full bg-yellow-400/10 px-2 py-0.5 text-xs font-medium text-yellow-400">
              Graduated
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-400">
              <TrendingUp className="h-3.5 w-3.5" />
              {summary.priceEth.toExponential(3)} ETH
            </span>
          )}
        </div>

        {!summary.graduated && (
          <div className="mt-3">
            <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full bg-violet-500"
                style={{ width: `${Math.round(summary.graduationProgress * 100)}%` }}
              />
            </div>

            <p className="mt-1.5 text-[11px] text-zinc-500">
              {(summary.graduationProgress * 100).toFixed(1)}% to graduation
            </p>
          </div>
        )}
      </div>
    </Link>
  );
}

/*
 * Data loading goes through React Query rather than an effect + setState: the
 * launch index is expensive enough server-side that its result is worth
 * caching between navigations, and it keeps the component free of the
 * cascading-render pattern the React compiler rejects.
 */
async function fetchMarket(refresh: boolean) {
  const res = await fetch(
    `/api/pons/launches?limit=48${refresh ? "&refresh=1" : ""}`,
  );

  const data = await res.json();

  if (!res.ok || !data.success) {
    throw new Error(data.message || "Could not load launches.");
  }

  const launches: LaunchRow[] = data.launches ?? [];

  if (launches.length === 0) {
    return { summaries: [] as Summary[], total: 0, stale: Boolean(data.stale) };
  }

  const priced = await fetch("/api/pons/prices", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tokens: launches.map((l) => l.token) }),
  }).then((r) => r.json());

  return {
    summaries: (priced.summaries ?? []) as Summary[],
    total: Number(data.total ?? launches.length),
    stale: Boolean(data.stale),
  };
}

export default function PonsMarketPage() {
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["pons", "market"],
    queryFn: () => fetchMarket(refreshing),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const summaries = data?.summaries ?? [];
  const loading = isLoading || isFetching;

  const status = data
    ? data.stale
      ? "Index rebuilt just now."
      : `Indexed ${data.total} launches.`
    : loading
      ? "Loading launch index..."
      : "";

  async function hardRefresh() {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }

  return (
    <main className="min-h-screen bg-[#05070b] text-white">
      <div className={PAGE_CONTAINER}>
        <div className="mb-10 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Pons Market</h1>

            <p className="mt-3 max-w-xl text-zinc-400">
              Tokens launched on Pons, trading in Uniswap V3 pools on Robinhood
              Chain. Prices are read live from each pool.
            </p>

            {status && <p className="mt-2 text-xs text-zinc-600">{status}</p>}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={hardRefresh}
              disabled={loading}
              className="flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-xs font-medium text-zinc-300 transition hover:border-white/20 disabled:opacity-40"
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
              Refresh
            </button>

            <Link
              href="/pons/launch"
              className="flex h-9 items-center gap-2 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 text-xs font-semibold text-violet-300 transition hover:bg-violet-500/20"
            >
              <Rocket size={13} />
              Launch
            </Link>

            <EvmWalletButton />
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error instanceof Error ? error.message : "Failed to load."}
          </div>
        )}

        {loading && summaries.length === 0 ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-72 animate-pulse rounded-2xl border border-white/[0.08] bg-white/[0.02]"
              />
            ))}
          </div>
        ) : summaries.length === 0 ? (
          <p className="py-20 text-center text-zinc-500">
            No Pons tokens found. The first load builds the index and can take a
            minute against the public RPC.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {summaries.map((s) => (
              <TokenCard key={s.token} summary={s} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
