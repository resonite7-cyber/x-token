import { NextResponse } from "next/server";

import type { Address } from "viem";

import { getPonsClient, getTokenSummaries } from "../../../src/lib/pons/trade";

/*
 * Batched price/metadata lookup for the market grid.
 *
 * Doing this per-card in the browser would fire hundreds of reads at a
 * rate-limited RPC. Here it collapses into Multicall3 batches on one server.
 */
export async function POST(request: Request) {
  try {
    const { tokens } = (await request.json()) as { tokens?: string[] };

    if (!Array.isArray(tokens) || tokens.length === 0) {
      return NextResponse.json({ success: true, summaries: [] });
    }

    if (tokens.length > 100) {
      return NextResponse.json(
        { success: false, message: "Too many tokens in one request." },
        { status: 400 },
      );
    }

    const client = getPonsClient();

    const summaries = await getTokenSummaries(client, tokens as Address[]);

    return NextResponse.json({
      success: true,
      summaries: summaries.map((s) => ({
        ...s,
        totalSupply: s.totalSupply.toString(),
        pairedPrincipal: s.pairedPrincipal.toString(),
        graduationThreshold: s.graduationThreshold.toString(),
      })),
    });
  } catch (error) {
    console.error("Pons price lookup failed:", error);

    return NextResponse.json(
      { success: false, message: "Price lookup failed.", summaries: [] },
      { status: 503 },
    );
  }
}
