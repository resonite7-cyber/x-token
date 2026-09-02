import { NextResponse } from "next/server";

import { isAddress, type Address } from "viem";

import { getPonsClient } from "../../src/lib/pons/trade";
import { buildPortfolio, type Portfolio } from "../../src/lib/pons/portfolio";

/*
 * Portfolio snapshot for one wallet.
 *
 * This runs server-side for the same reason the launch index does: building it
 * costs several wallet-wide log scans plus a receipt per trade, and the public
 * Robinhood RPC throttles on request volume. Doing it in the browser would put
 * that load on every page view and every tab.
 *
 * The cache is in memory rather than on disk — unlike data/pons-launches.json,
 * this is per-wallet data, and there is no reason to leave a user's holdings
 * sitting in a file on the server. It is lost on restart, which only costs one
 * rebuild.
 */

const TTL_MS = 2 * 60 * 1000;

/** Wallets to keep cached. Bounded so a busy deployment cannot grow forever. */
const MAX_ENTRIES = 200;

interface CacheEntry {
  updatedAt: number;
  portfolio: Portfolio;
}

const cache = new Map<string, CacheEntry>();

/** One rebuild per wallet at a time; concurrent callers share the result. */
const inFlight = new Map<string, Promise<Portfolio>>();

function remember(key: string, portfolio: Portfolio): void {
  cache.set(key, { updatedAt: Date.now(), portfolio });

  // Map iterates in insertion order, so the oldest key is the first one.
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;

    if (oldest === undefined) break;

    cache.delete(oldest);
  }
}

/** bigint is not JSON-serialisable; every one becomes a decimal string. */
function serialise(portfolio: Portfolio) {
  return {
    user: portfolio.user,
    blockNumber: portfolio.blockNumber.toString(),
    nativeEthBalance: portfolio.nativeEthBalance.toString(),
    wethBalance: portfolio.wethBalance.toString(),
    totals: portfolio.totals,
    tradesTruncated: portfolio.tradesTruncated,
    holdings: portfolio.holdings.map((h) => ({
      ...h,
      balance: h.balance.toString(),
      trackedBalance: h.trackedBalance.toString(),
      untrackedBalance: h.untrackedBalance.toString(),
    })),
    createdTokens: portfolio.createdTokens.map((c) => ({
      ...c,
      balance: c.balance.toString(),
      blockNumber: c.blockNumber.toString(),
      initialBuyEth: c.initialBuyEth.toString(),
    })),
    trades: portfolio.trades.map((t) => ({
      ...t,
      blockNumber: t.blockNumber.toString(),
      tokenAmount: t.tokenAmount.toString(),
      ethAmount: t.ethAmount.toString(),
    })),
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);

  const address = url.searchParams.get("address");
  const force = url.searchParams.get("refresh") === "1";

  // No wallet, no query. The page must not reach the chain when disconnected.
  if (!address || !isAddress(address)) {
    return NextResponse.json(
      { success: false, message: "A valid wallet address is required." },
      { status: 400 },
    );
  }

  const key = address.toLowerCase();

  const cached = force ? undefined : cache.get(key);

  if (cached && Date.now() - cached.updatedAt < TTL_MS) {
    return NextResponse.json({
      success: true,
      updatedAt: cached.updatedAt,
      cached: true,
      portfolio: serialise(cached.portfolio),
    });
  }

  let build = inFlight.get(key);

  if (!build) {
    build = buildPortfolio({
      client: getPonsClient(),
      user: address as Address,
    }).finally(() => {
      inFlight.delete(key);
    });

    inFlight.set(key, build);
  }

  try {
    const portfolio = await build;

    remember(key, portfolio);

    return NextResponse.json({
      success: true,
      updatedAt: Date.now(),
      cached: false,
      portfolio: serialise(portfolio),
    });
  } catch (error) {
    console.error("Portfolio build failed:", error);

    // Stale beats wrong: never fall back to zeroes, which would read as "you
    // own nothing" rather than "we could not reach the chain".
    const stale = cache.get(key);

    if (stale) {
      return NextResponse.json({
        success: true,
        updatedAt: stale.updatedAt,
        cached: true,
        stale: true,
        portfolio: serialise(stale.portfolio),
      });
    }

    return NextResponse.json(
      { success: false, message: "Could not reach Robinhood Chain." },
      { status: 503 },
    );
  }
}
