"use client";

import { useEffect, useState } from "react";

import Link from "next/link";

import { useRouter } from "next/navigation";

import { useConnection } from "@solana/wallet-adapter-react";

import { PublicKey } from "@solana/web3.js";

import { ImageOff, ShoppingCart, TrendingUp } from "lucide-react";

import { getMintPrice } from "../src/lib/pumpTrade";

interface CreatedCoin {
  name: string;
  symbol: string;
  mint: string;
  creatorWallet: string;
  createdAt: string;
  image?: string;
}

type PriceState =
  | { status: "loading" }
  | { status: "ready"; priceSol: number; graduated: boolean }
  | { status: "error" };

function CoinImage({ src, alt }: { src?: string; alt: string }) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div className="flex aspect-square w-full items-center justify-center bg-gradient-to-br from-zinc-900 to-black text-zinc-700">
        <ImageOff className="h-8 w-8" />
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- arbitrary user-supplied metadata URIs, not local/optimizable assets
    <img
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      className="aspect-square w-full object-cover"
    />
  );
}

function PriceTag({
  mint,
  onGraduatedChange,
}: {
  mint: string;
  onGraduatedChange?: (graduated: boolean) => void;
}) {
  const { connection } = useConnection();

  const [price, setPrice] = useState<PriceState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading flag for an in-flight fetch triggered by this effect
    setPrice({ status: "loading" });

    let mintKey: PublicKey;

    try {
      mintKey = new PublicKey(mint);
    } catch {
      setPrice({ status: "error" });
      return;
    }

    getMintPrice(connection, mintKey)
      .then(({ priceSol, graduated }) => {
        if (!cancelled) {
          setPrice({ status: "ready", priceSol, graduated });
          onGraduatedChange?.(graduated);
        }
      })
      .catch(() => {
        if (!cancelled) setPrice({ status: "error" });
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onGraduatedChange is expected to be stable per-card
  }, [connection, mint]);

  if (price.status === "loading") {
    return <span className="inline-block h-4 w-20 animate-pulse rounded bg-white/10" />;
  }

  if (price.status === "error") {
    return <span className="text-xs text-zinc-600">Price unavailable</span>;
  }

  if (price.status === "ready" && price.graduated) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-yellow-400/10 px-2 py-0.5 text-xs font-medium text-yellow-400">
        Migrated
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-400">
      <TrendingUp className="h-3.5 w-3.5" />
      {price.priceSol.toFixed(10)} SOL
    </span>
  );
}

function CoinCard({ coin }: { coin: CreatedCoin }) {
  const router = useRouter();

  const [graduated, setGraduated] = useState(false);

  const goToBuy = (e: React.MouseEvent) => {
    e.preventDefault();
    router.push(`/trade/${coin.mint}?side=buy`);
  };

  return (
    <Link
      href={`/trade/${coin.mint}`}
      className="group overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02] transition hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.04]"
    >
      <div className="relative overflow-hidden">
        <CoinImage src={coin.image} alt={coin.name} />

        <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-zinc-300 backdrop-blur">
          {coin.symbol}
        </span>
      </div>

      <div className="p-4">
        <p className="truncate font-semibold">{coin.name}</p>

        <p className="mt-0.5 truncate text-xs text-zinc-500">
          {coin.mint.slice(0, 4)}...{coin.mint.slice(-4)}
        </p>

        <div className="mt-3">
          <PriceTag mint={coin.mint} onGraduatedChange={setGraduated} />
        </div>

        <div className="mt-3">
          <button
            onClick={goToBuy}
            disabled={graduated}
            className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-violet-500/30 bg-violet-500/10 text-xs font-semibold text-violet-300 transition hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ShoppingCart size={13} />
            Buy
          </button>
        </div>
      </div>
    </Link>
  );
}

export default function TradeIndexPage() {
  const [coins, setCoins] = useState<CreatedCoin[]>([]);

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/coins")
      .then((res) => (res.ok ? res.json() : { coins: [] }))
      .then((data) => setCoins(data.coins ?? []))
      .catch(() => setCoins([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="min-h-screen bg-[#05070b] text-white">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="mb-10 text-center">
          <h1 className="text-3xl font-bold tracking-tight">Trade Coins</h1>

          <p className="mt-3 text-zinc-400">
            Coins created on this app. Pick one to buy or sell.
          </p>
        </div>

        {loading && (
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02]"
              >
                <div className="aspect-square w-full animate-pulse bg-white/[0.04]" />
                <div className="space-y-2 p-4">
                  <div className="h-4 w-3/4 animate-pulse rounded bg-white/10" />
                  <div className="h-3 w-1/3 animate-pulse rounded bg-white/10" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && coins.length === 0 && (
          <p className="text-center text-sm text-zinc-500">
            No coins created yet.{" "}
            <Link href="/" className="text-blue-400 hover:text-blue-300">
              Launch one
            </Link>
            .
          </p>
        )}

        {!loading && coins.length > 0 && (
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
            {coins.map((coin) => (
              <CoinCard key={coin.mint} coin={coin} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
