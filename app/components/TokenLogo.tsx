"use client";

import { useState } from "react";

import { resolveLogoUrl } from "../src/lib/pons/trade";

/*
 * A token's logo, or a readable placeholder when there isn't one.
 *
 * Logo URLs are whatever the creator wrote on-chain, so some of them are dead
 * (a token pointing at a Twitter avatar that has since 404'd, for one). Left
 * alone the browser paints its broken-image glyph, which reads as an app bug.
 * Falling back to the symbol keeps a dead link looking deliberate.
 */
export default function TokenLogo({
  logo,
  symbol,
  alt,
  className = "",
  sizeClass = "h-9 w-9",
  rounded = "rounded-lg",
}: {
  logo: string;
  symbol: string;
  alt?: string;
  className?: string;
  sizeClass?: string;
  rounded?: string;
}) {
  const [failed, setFailed] = useState(false);

  const src = resolveLogoUrl(logo);

  if (!src || failed) {
    return (
      <div
        className={`flex ${sizeClass} shrink-0 items-center justify-center ${rounded} bg-white/[0.05] text-[11px] font-bold text-zinc-600 ${className}`}
      >
        {(symbol || "?").slice(0, 3)}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt || symbol}
      onError={() => setFailed(true)}
      className={`${sizeClass} shrink-0 ${rounded} object-cover ${className}`}
      loading="lazy"
    />
  );
}
