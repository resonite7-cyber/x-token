"use client";

import { useEffect, useState } from "react";

import Link from "next/link";

import { useWallet } from "@solana/wallet-adapter-react";

import SolanaWalletButton from "../components/SolanaWalletButton";

interface CreatedCoin {
  name: string;
  symbol: string;
  mint: string;
  creatorWallet: string;
  createdAt: string;
}

export default function CreatedTokensPage() {
  const { publicKey, connected } = useWallet();

  const [coins, setCoins] = useState<CreatedCoin[]>([]);

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/coins")
      .then((res) => (res.ok ? res.json() : { coins: [] }))
      .then((data) => setCoins(data.coins ?? []))
      .catch(() => setCoins([]))
      .finally(() => setLoading(false));
  }, []);

  const myCoins = connected && publicKey
    ? coins.filter((coin) => coin.creatorWallet === publicKey.toBase58())
    : [];

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-2xl px-6 py-12">
        <div className="mb-10 text-center">
          <h1 className="text-3xl font-bold">What We&apos;ve Created</h1>

          <p className="mt-3 text-gray-400">
            Tokens you&apos;ve launched from this wallet.
          </p>
        </div>

        {!connected && (
          <div className="rounded-2xl border border-gray-800 bg-gray-950 p-6 text-center">
            <p className="mb-5 text-sm text-gray-400">
              Connect your wallet to see the tokens you&apos;ve created.
            </p>

            <div className="flex justify-center">
              <SolanaWalletButton />
            </div>
          </div>
        )}

        {connected && loading && (
          <p className="text-center text-sm text-gray-500">Loading...</p>
        )}

        {connected && !loading && myCoins.length === 0 && (
          <p className="text-center text-sm text-gray-500">
            You haven&apos;t created any tokens yet.{" "}
            <Link href="/" className="text-blue-400 hover:text-blue-300">
              Launch one
            </Link>
            .
          </p>
        )}

        {connected && myCoins.length > 0 && (
          <div className="space-y-4">
            {myCoins.map((coin) => (
              <Link
                key={coin.mint}
                href={`/trade/${coin.mint}`}
                className="block rounded-2xl border border-gray-800 bg-gray-950 p-6 transition hover:border-gray-600"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold">{coin.name}</p>

                    <p className="text-sm text-gray-500">{coin.symbol}</p>
                  </div>

                  <p className="text-sm text-blue-400">Trade →</p>
                </div>

                <p className="mt-3 break-all text-xs text-gray-600">
                  {coin.mint}
                </p>

                <p className="mt-2 text-xs text-gray-700">
                  Created {new Date(coin.createdAt).toLocaleString()}
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
