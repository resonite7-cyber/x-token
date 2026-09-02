import { lookup } from "dns/promises";

import { NextResponse } from "next/server";

/*
 * Same-origin proxy for token logo images.
 *
 * Logos are whatever URL the token's creator wrote on-chain: IPFS gateways,
 * Twitter CDNs, random hosts. Loading them cross-origin was unreliable — the
 * public IPFS gateways answer a browser's image request differently from a
 * plain GET (Chrome reported ERR_BLOCKED_BY_RESPONSE.NotSameOrigin for every
 * ipfs.io logo while direct https logos loaded fine), which is why some cards
 * showed an image and some did not.
 *
 * Serving the bytes from this origin removes that whole class of failure:
 * there is no CORP, ORB or CORS decision left for the browser to make, and it
 * works the same for every host a creator might have used.
 *
 * SAFETY
 *
 * This fetches a URL supplied by the caller, so it is an SSRF surface. It is
 * therefore restricted to http(s), refuses hosts that resolve to private,
 * loopback or link-local addresses, validates every redirect hop the same
 * way, caps the response size, and passes through only image content types.
 */

/** Redirect hops to follow. IPFS gateways use one or two. */
const MAX_REDIRECTS = 3;

/** Upstream fetch budget. */
const TIMEOUT_MS = 10_000;

/** Largest logo to relay, in bytes. */
const MAX_BYTES = 5 * 1024 * 1024;

/** Content-addressed images never change, so let the browser keep them. */
const CACHE_CONTROL = "public, max-age=86400, stale-while-revalidate=604800";

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);

  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;

  const [a, b] = parts;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

function isPrivateIpv6(ip: string): boolean {
  const value = ip.toLowerCase();

  if (value === "::" || value === "::1") return true;

  // Unique-local (fc00::/7) and link-local (fe80::/10).
  if (value.startsWith("fc") || value.startsWith("fd")) return true;
  if (value.startsWith("fe8") || value.startsWith("fe9")) return true;
  if (value.startsWith("fea") || value.startsWith("feb")) return true;

  // IPv4-mapped, e.g. ::ffff:127.0.0.1.
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);

  if (mapped) return isPrivateIpv4(mapped[1]);

  return false;
}

/** True when the URL is safe to fetch from the server. */
async function isPublicHttpUrl(url: URL): Promise<boolean> {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;

  try {
    // `all` so a host that resolves to both a public and a private address is
    // still rejected rather than racing on which one fetch picks.
    const addresses = await lookup(url.hostname, { all: true });

    if (addresses.length === 0) return false;

    return addresses.every(({ address, family }) =>
      family === 6 ? !isPrivateIpv6(address) : !isPrivateIpv4(address),
    );
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  const target = new URL(request.url).searchParams.get("url");

  if (!target) {
    return NextResponse.json({ message: "url is required." }, { status: 400 });
  }

  let current: URL;

  try {
    current = new URL(target);
  } catch {
    return NextResponse.json({ message: "Invalid url." }, { status: 400 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    let response: Response | null = null;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!(await isPublicHttpUrl(current))) {
        return NextResponse.json(
          { message: "Refusing to fetch that host." },
          { status: 400 },
        );
      }

      // Manual redirects so every hop gets the private-address check above.
      response = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: { accept: "image/*" },
      });

      if (response.status < 300 || response.status >= 400) break;

      const location = response.headers.get("location");

      if (!location) break;

      current = new URL(location, current);
      response = null;
    }

    if (!response) {
      return NextResponse.json({ message: "Too many redirects." }, { status: 502 });
    }

    if (!response.ok || !response.body) {
      return NextResponse.json(
        { message: "Upstream did not return an image." },
        { status: 502 },
      );
    }

    const contentType = response.headers.get("content-type") ?? "";

    if (!contentType.startsWith("image/")) {
      return NextResponse.json(
        { message: "Upstream did not return an image." },
        { status: 415 },
      );
    }

    const declared = Number(response.headers.get("content-length") ?? "0");

    if (declared > MAX_BYTES) {
      return NextResponse.json({ message: "Image too large." }, { status: 413 });
    }

    // Buffer rather than stream so the size cap is enforced even when the
    // upstream declares no content-length.
    const bytes = new Uint8Array(await response.arrayBuffer());

    if (bytes.byteLength > MAX_BYTES) {
      return NextResponse.json({ message: "Image too large." }, { status: 413 });
    }

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "content-type": contentType,
        "content-length": String(bytes.byteLength),
        "cache-control": CACHE_CONTROL,
        // The bytes came from an arbitrary third-party host; never let a
        // response that is not an image be sniffed into something executable.
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; img-src 'self' data:",
      },
    });
  } catch {
    return NextResponse.json({ message: "Could not fetch image." }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
