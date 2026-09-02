"use client";

import { useCallback, useState } from "react";

import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";

import type {
  PortfolioTotals,
  TradeAction,
} from "../lib/pons/portfolio";

/*
 * Portfolio data for the connected wallet.
 *
 * The heavy lifting lives in /api/portfolio, which caches per wallet — this
 * hook only decides when to ask. Following the market page, that means React
 * Query with a long staleTime and NO polling interval: a portfolio rebuild is
 * several log scans, so it happens when the user asks for it, when they land
 * on the page cold, or when the cache has aged out. Not every 30 seconds.
 */

/** The API serialises every bigint as a decimal string. */
export interface HoldingRow {
  token: string;
  name: string;
  symbol: string;
  logo: string;
  decimals: number;
  balance: string;
  priceEth: number | null;
  valueEth: number | null;
  costBasisEth: number;
  trackedBalance: string;
  untrackedBalance: string;
  avgBuyPriceEth: number | null;
  unrealizedPnlEth: number | null;
  unrealizedPnlPercent: number | null;
  realizedPnlEth: number;
  marketCapEth: number | null;
  graduated: boolean;
  graduationProgress: number;
  isCreatedByUser: boolean;
  costBasisComplete: boolean;
}

export interface CreatedRow {
  token: string;
  name: string;
  symbol: string;
  logo: string;
  priceEth: number | null;
  marketCapEth: number | null;
  liquidityEth: number | null;
  graduated: boolean;
  graduationProgress: number;
  balance: string;
  transactionHash: string;
  blockNumber: string;
  timestamp: number | null;
  initialBuyEth: string;
}

export interface TradeRow {
  transactionHash: string;
  blockNumber: string;
  timestamp: number | null;
  token: string;
  symbol: string;
  action: TradeAction;
  tokenAmount: string;
  ethAmount: string;
  priceEth: number | null;
}

export interface PortfolioData {
  user: string;
  blockNumber: string;
  nativeEthBalance: string;
  wethBalance: string;
  totals: PortfolioTotals;
  tradesTruncated: boolean;
  holdings: HoldingRow[];
  createdTokens: CreatedRow[];
  trades: TradeRow[];
}

async function fetchPortfolio(
  address: string,
  refresh: boolean,
): Promise<{ portfolio: PortfolioData; updatedAt: number; stale: boolean }> {
  const res = await fetch(
    `/api/portfolio?address=${address}${refresh ? "&refresh=1" : ""}`,
  );

  const data = await res.json();

  if (!res.ok || !data.success) {
    throw new Error(data.message || "Could not load your portfolio.");
  }

  return {
    portfolio: data.portfolio as PortfolioData,
    updatedAt: Number(data.updatedAt),
    stale: Boolean(data.stale),
  };
}

export function usePortfolio() {
  const { address, isConnected, isConnecting, isReconnecting } = useAccount();

  const [forceNext, setForceNext] = useState(false);

  const query = useQuery({
    queryKey: ["portfolio", address],
    queryFn: () => fetchPortfolio(address!, forceNext),
    // Never query the chain for a wallet that is not connected.
    enabled: Boolean(address) && isConnected,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchInterval: false,
    retry: 1,
  });

  const refresh = useCallback(async () => {
    setForceNext(true);

    try {
      await query.refetch();
    } finally {
      setForceNext(false);
    }
  }, [query]);

  return {
    address,
    isConnected,
    // wagmi reconnects on mount, so this covers the "restoring session" gap
    // that would otherwise flash the disconnected empty state.
    isConnecting: isConnecting || isReconnecting,
    portfolio: query.data?.portfolio ?? null,
    updatedAt: query.data?.updatedAt ?? null,
    stale: query.data?.stale ?? false,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error instanceof Error ? query.error.message : null,
    refresh,
  };
}
