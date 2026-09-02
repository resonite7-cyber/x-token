import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

import { NextResponse } from "next/server";

import { getPonsClient, getRecentLaunches } from "../../../src/lib/pons/trade";

/*
 * Cached listing of the newest Pons launches.
 *
 * This is deliberately NOT a full index. Pons has launched 150,000+ tokens and
 * the public RPC caps each log response at roughly 2,000 entries, so a
 * complete scan is a database's job — Bitquery and Mobula both index Robinhood
 * Chain if this app ever needs search or full history. Here the scan walks
 * backwards from the head and stops at `limit`.
 *
 * Even bounded, that is several RPC round-trips, so results are cached on a
 * TTL rather than rebuilt per page view.
 *
 * Same caveat as data/created-coins.json: on an ephemeral filesystem (Render,
 * Vercel) this cache is lost on deploy and the first request after a cold
 * start pays for the scan.
 */

const CACHE_FILE = path.join(process.cwd(), "data", "pons-launches.json");

const TTL_MS = 30 * 60 * 1000;

interface CachedLaunch {
  token: string;
  deployer: string;
  pool: string;
  positionId: string;
  initialBuyAmount: string;
  blockNumber: string;
  transactionHash: string;
  factory: string;
}

interface CacheShape {
  updatedAt: number;
  launches: CachedLaunch[];
}

let inFlight: Promise<CacheShape> | null = null;

async function readCache(): Promise<CacheShape | null> {
  try {
    return JSON.parse(await readFile(CACHE_FILE, "utf-8")) as CacheShape;
  } catch {
    return null;
  }
}

async function writeCache(cache: CacheShape): Promise<void> {
  try {
    await mkdir(path.dirname(CACHE_FILE), { recursive: true });
    await writeFile(CACHE_FILE, JSON.stringify(cache), "utf-8");
  } catch (error) {
    // A read-only filesystem should degrade to "rescan next time", not 500.
    console.error("Failed to persist Pons launch cache:", error);
  }
}

async function rebuild(limit: number): Promise<CacheShape> {
  const client = getPonsClient();

  const launches = await getRecentLaunches({ client, limit });

  const cache: CacheShape = {
    updatedAt: Date.now(),
    launches: launches.map((l): CachedLaunch => ({
      token: l.token,
      deployer: l.deployer,
      pool: l.pool,
      positionId: l.positionId.toString(),
      initialBuyAmount: l.initialBuyAmount.toString(),
      blockNumber: l.blockNumber.toString(),
      transactionHash: l.transactionHash,
      factory: l.factory,
    })),
  };

  await writeCache(cache);

  return cache;
}

export async function GET(request: Request) {
  const url = new URL(request.url);

  const limit = Number(url.searchParams.get("limit") ?? "60");
  const force = url.searchParams.get("refresh") === "1";

  const cached = force ? null : await readCache();

  const fresh = cached && Date.now() - cached.updatedAt < TTL_MS;

  let data: CacheShape;

  if (fresh) {
    data = cached;
  } else {
    // Collapse concurrent misses onto one scan; a burst of page loads must not
    // each kick off their own 40-request walk.
    inFlight ??= rebuild(Math.max(limit, 48)).finally(() => {
      inFlight = null;
    });

    try {
      data = await inFlight;
    } catch (error) {
      console.error("Pons launch scan failed:", error);

      // Stale beats empty when the RPC is throttling us.
      if (cached) {
        data = cached;
      } else {
        return NextResponse.json(
          { success: false, message: "Could not reach Robinhood Chain.", launches: [] },
          { status: 503 },
        );
      }
    }
  }

  return NextResponse.json({
    success: true,
    updatedAt: data.updatedAt,
    stale: !fresh,
    total: data.launches.length,
    launches: Number.isFinite(limit) && limit > 0
      ? data.launches.slice(0, limit)
      : data.launches,
  });
}
