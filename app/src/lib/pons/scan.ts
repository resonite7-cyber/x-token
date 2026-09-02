import type { Abi, Address, PublicClient } from "viem";

/*
 * Resilient log scanning for Robinhood Chain.
 *
 * The public RPC caps a response by the NUMBER of logs it would return, not by
 * the block range. Measured behaviour: a 1.2M-block window returning 1,809
 * logs succeeds, a 1.5M window over the same dense region fails, and a
 * 15M-block window over an empty region succeeds in ~1s. The cap sits around
 * 2,000 logs, and it reports the refusal as "Missing or invalid parameters"
 * rather than a range or size error.
 *
 * Two consequences drive this implementation:
 *
 *  1. Failures are DETERMINISTIC. Retrying the identical request always fails
 *     again, so there is no backoff here — a failure means "ask for a smaller
 *     window", immediately. An earlier version retried with sleeps and turned
 *     a ~1 minute scan into a 30+ minute one.
 *
 *  2. Empty ranges are nearly free. The window is therefore sized from the
 *     observed log DENSITY of the previous chunk rather than by blindly
 *     doubling: a chunk that came back near the cap shrinks the next window
 *     proportionally, and an empty chunk jumps straight back to the ceiling.
 *     Doubling-then-halving oscillates around the cap and pays for a failed
 *     request on every other chunk; density targeting converges in one step.
 *
 * Results are deterministic and complete — the same query returns the same
 * count every time — so a successful chunk is never silently truncated.
 */

/**
 * Logs to aim for per request. The measured cap is around 2,000; this leaves
 * headroom so a denser-than-expected chunk still lands under it.
 */
const TARGET_LOGS = 1200n;

export interface ScanOptions {
  /**
   * Contract to scan. Omit to scan EVERY contract and rely on the topic
   * filter alone — that is how a wallet-wide ERC-20 Transfer scan finds
   * tokens whose addresses are not known up front.
   */
  address?: Address;
  abi: Abi;
  eventName: string;
  /** Indexed-argument filter, applied by the node. */
  args?: Record<string, unknown>;
  fromBlock: bigint;
  toBlock: bigint;
  /** Starting and maximum window. Empty regions are cheap, so start big. */
  chunkSize?: bigint;
  /**
   * Smallest window to try before giving up on a span. A region dense enough
   * to exceed the log cap inside this many blocks would be pathological.
   */
  minChunk?: bigint;
  onProgress?: (scannedTo: bigint, total: bigint, found: number) => void;
}

export async function scanLogs<T = unknown>(
  client: PublicClient,
  {
    address,
    abi,
    eventName,
    args,
    fromBlock,
    toBlock,
    chunkSize = 8000000n,
    minChunk = 1000n,
    onProgress,
  }: ScanOptions,
): Promise<T[]> {
  const out: T[] = [];
  const total = toBlock - fromBlock;

  let cursor = fromBlock;
  let window = chunkSize;

  while (cursor < toBlock) {
    const end = cursor + window > toBlock ? toBlock : cursor + window;

    let logs: T[] | null = null;

    try {
      logs = (await client.getContractEvents({
        ...(address ? { address } : {}),
        abi,
        eventName,
        ...(args ? { args } : {}),
        fromBlock: cursor,
        toBlock: end,
      } as never)) as T[];
    } catch {
      logs = null;
    }

    if (logs === null) {
      if (window > minChunk) {
        // Too many logs in this window. Halve and retry the same start block —
        // never advance past a failed span, or launches vanish from the index.
        window = window / 2n > minChunk ? window / 2n : minChunk;
        continue;
      }

      // Below the floor and still failing. Advance so one pathological span
      // cannot stall the scan, and make the gap visible rather than silent.
      console.warn(
        `scanLogs: skipping ${cursor}-${end} for ${address ?? "any address"}; still over the log cap at the minimum window.`,
      );

      cursor = end;
      window = chunkSize;
      continue;
    }

    out.push(...logs);

    onProgress?.(end, total, out.length);

    // Measure density over the span actually requested, before the cursor
    // moves — at the tail this is shorter than `window`.
    const span = end - cursor;

    cursor = end;

    // Size the next window from this one's density, aiming for TARGET_LOGS —
    // comfortably under the cap so a modest density increase does not cost a
    // failed request. An empty chunk implies an empty region: go straight back
    // to the ceiling instead of creeping up a factor at a time.
    const found = BigInt(logs.length);

    if (found === 0n) {
      window = chunkSize;
    } else {
      const scaled = (span * TARGET_LOGS) / found;

      window =
        scaled > chunkSize ? chunkSize : scaled < minChunk ? minChunk : scaled;
    }
  }

  return out;
}


/**
 * Newest-first scan that stops as soon as `limit` logs are collected.
 *
 * The forward scanner above exists to walk a whole range; this one exists
 * because walking the whole range is not something a page load can afford.
 * Pons has launched well over 150,000 tokens, so a full index is a database
 * job, not a JSON cache — but a market page only ever wants the newest few
 * dozen, and those live at the END of the range.
 *
 * Walking backwards makes that cheap: the ~16M blocks between the last launch
 * and the chain head are empty and cost a couple of requests, and the first
 * dense window then supplies far more than a page needs.
 *
 * Windows are density-sized exactly as in scanLogs, and a window that exceeds
 * the node's log cap is halved from the same anchor, never skipped.
 */
export async function scanLogsBackward<T extends { blockNumber: bigint }>(
  client: PublicClient,
  {
    address,
    abi,
    eventName,
    args,
    fromBlock,
    toBlock,
    limit,
    chunkSize = 8000000n,
    minChunk = 1000n,
    onProgress,
  }: ScanOptions & { limit: number },
): Promise<T[]> {
  const out: T[] = [];

  let cursor = toBlock;
  let window = chunkSize;

  while (cursor > fromBlock && out.length < limit) {
    const start = cursor - window < fromBlock ? fromBlock : cursor - window;

    let logs: T[] | null = null;

    try {
      logs = (await client.getContractEvents({
        ...(address ? { address } : {}),
        abi,
        eventName,
        ...(args ? { args } : {}),
        fromBlock: start,
        toBlock: cursor,
      } as never)) as unknown as T[];
    } catch {
      logs = null;
    }

    if (logs === null) {
      if (window > minChunk) {
        window = window / 2n > minChunk ? window / 2n : minChunk;
        continue;
      }

      console.warn(
        `scanLogsBackward: skipping ${start}-${cursor} for ${address ?? "any address"}; over the log cap at the minimum window.`,
      );

      cursor = start;
      window = chunkSize;
      continue;
    }

    // Newest first within the chunk, so the caller's slice takes the latest.
    out.push(...logs.sort((a, b) => Number(b.blockNumber - a.blockNumber)));

    onProgress?.(start, toBlock - fromBlock, out.length);

    const span = cursor - start;

    cursor = start;

    const found = BigInt(logs.length);

    if (found === 0n) {
      window = chunkSize;
    } else {
      const scaled = (span * TARGET_LOGS) / found;

      window =
        scaled > chunkSize ? chunkSize : scaled < minChunk ? minChunk : scaled;
    }
  }

  return out.slice(0, limit);
}
