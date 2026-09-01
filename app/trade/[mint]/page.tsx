"use client";

import { useEffect, useMemo, useState } from "react";

import { useParams } from "next/navigation";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";

import { PublicKey } from "@solana/web3.js";

import BN from "bn.js";

import SolanaWalletButton from "../../components/SolanaWalletButton";

import {
  buildBuyTransaction,
  buildSellTransaction,
  getMintTradeState,
  solToLamports,
  type MintTradeState,
} from "../../src/lib/pumpTrade";

const SOLANA_RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

const SOLSCAN_CLUSTER_PARAM = SOLANA_RPC_URL.includes("devnet")
  ? "?cluster=devnet"
  : SOLANA_RPC_URL.includes("testnet")
    ? "?cluster=testnet"
    : "";

type Tab = "buy" | "sell";

const SELL_PERCENT_OPTIONS: { label: string; percent: number }[] = [
  { label: "10%", percent: 10 },
  { label: "20%", percent: 20 },
  { label: "50%", percent: 50 },
  { label: "Max", percent: 100 },
];

function getSellAmountForPercent(balance: string, percent: number): string {
  try {
    const balanceBigInt = BigInt(balance);
    return ((balanceBigInt * BigInt(percent)) / BigInt(100)).toString();
  } catch {
    return "0";
  }
}

export default function TradePage() {
  const params = useParams<{ mint: string }>();

  const mint = useMemo(() => {
    try {
      return new PublicKey(params.mint);
    } catch {
      return null;
    }
  }, [params.mint]);

  const { publicKey, connected, signTransaction } = useWallet();

  const { connection } = useConnection();

  const [tab, setTab] = useState<Tab>("buy");

  const [state, setState] = useState<MintTradeState | null>(null);

  const [loadingState, setLoadingState] = useState(false);

  const [solInput, setSolInput] = useState("");

  const [tokenInput, setTokenInput] = useState("");

  const [busy, setBusy] = useState(false);

  const [error, setError] = useState("");

  const [signature, setSignature] = useState("");

  const fetchState = async () => {
    if (!mint || !publicKey) {
      return;
    }

    setError("");

    try {
      const nextState = await getMintTradeState({
        connection,
        mint,
        user: publicKey,
      });

      setState(nextState);
    } catch (err) {
      setState(null);

      setError(
        err instanceof Error ? err.message : "Failed to load coin state.",
      );
    } finally {
      setLoadingState(false);
    }
  };

  const refreshState = async () => {
    setLoadingState(true);
    await fetchState();
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading flag for an in-flight fetch triggered by this effect
    setLoadingState(true);
    fetchState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mint?.toBase58(), publicKey?.toBase58()]);

  const handleBuy = async () => {
    if (!mint || !publicKey || !signTransaction) {
      setError("Please connect your Solana wallet first.");
      return;
    }

    const sol = Number(solInput);

    if (!sol || sol <= 0) {
      setError("Enter a valid SOL amount.");
      return;
    }

    setBusy(true);
    setError("");
    setSignature("");

    try {
      const transaction = await buildBuyTransaction({
        connection,
        mint,
        user: publicKey,
        solAmountLamports: solToLamports(sol),
      });

      const signed = await signTransaction(transaction);

      const sig = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
      });

      await connection.confirmTransaction(
        {
          signature: sig,
          blockhash: transaction.recentBlockhash!,
          lastValidBlockHeight: transaction.lastValidBlockHeight!,
        },
        "confirmed",
      );

      setSignature(sig);
      setSolInput("");
      await refreshState();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Buy transaction failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleSell = async () => {
    if (!mint || !publicKey || !signTransaction) {
      setError("Please connect your Solana wallet first.");
      return;
    }

    const tokens = Number(tokenInput);

    if (!tokens || tokens <= 0) {
      setError("Enter a valid token amount.");
      return;
    }

    setBusy(true);
    setError("");
    setSignature("");

    try {
      const transaction = await buildSellTransaction({
        connection,
        mint,
        user: publicKey,
        tokenAmount: new BN(Math.floor(tokens)),
      });

      const signed = await signTransaction(transaction);

      const sig = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
      });

      await connection.confirmTransaction(
        {
          signature: sig,
          blockhash: transaction.recentBlockhash!,
          lastValidBlockHeight: transaction.lastValidBlockHeight!,
        },
        "confirmed",
      );

      setSignature(sig);
      setTokenInput("");
      await refreshState();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sell transaction failed.");
    } finally {
      setBusy(false);
    }
  };

  if (!mint) {
    return (
      <main className="min-h-screen bg-black text-white">
        <div className="mx-auto max-w-2xl px-6 py-12">
          <p className="text-red-400">Invalid mint address.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-2xl px-6 py-12">
        <div className="mb-10 text-center">
          <h1 className="text-3xl font-bold">Trade Coin</h1>

          <p className="mt-3 break-all text-xs text-gray-500">
            {mint.toBase58()}
          </p>

          <a
            href={`https://solscan.io/token/${mint.toBase58()}${SOLSCAN_CLUSTER_PARAM}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block text-sm text-blue-400 hover:text-blue-300"
          >
            View on Solscan ↗
          </a>
        </div>

        <div className="mb-6 rounded-2xl border border-gray-800 bg-gray-950 p-6">
          <h2 className="mb-5 text-xl font-semibold">Wallet</h2>

          <SolanaWalletButton />

          {connected && publicKey && (
            <p className="mt-4 break-all text-xs text-gray-500">
              {publicKey.toBase58()}
            </p>
          )}
        </div>

        {connected && (
          <div className="mb-6 rounded-2xl border border-gray-800 bg-gray-950 p-6">
            <h2 className="mb-4 text-xl font-semibold">Coin State</h2>

            {loadingState && (
              <p className="text-sm text-gray-500">Loading...</p>
            )}

            {!loadingState && state?.graduated && (
              <p className="text-sm text-yellow-400">
                This coin has migrated to the Pump AMM. Bonding-curve trading
                here is no longer available for it.
              </p>
            )}

            {!loadingState && state && !state.graduated && (
              <div className="space-y-2 text-sm text-gray-300">
                <p>Price: {state.priceSol.toFixed(10)} SOL / token</p>

                <p>Raised so far: {state.realQuoteReservesSol.toFixed(4)} SOL</p>

                <p>Your balance: {state.userTokenBalance} tokens</p>
              </div>
            )}
          </div>
        )}

        {connected && state && !state.graduated && (
          <div className="rounded-2xl border border-gray-800 bg-gray-950 p-6">
            <div className="mb-6 flex gap-2">
              <button
                onClick={() => setTab("buy")}
                className={`flex-1 rounded-xl px-4 py-3 font-semibold ${
                  tab === "buy"
                    ? "bg-white text-black"
                    : "border border-gray-800 text-gray-300"
                }`}
              >
                Buy
              </button>

              <button
                onClick={() => setTab("sell")}
                className={`flex-1 rounded-xl px-4 py-3 font-semibold ${
                  tab === "sell"
                    ? "bg-white text-black"
                    : "border border-gray-800 text-gray-300"
                }`}
              >
                Sell
              </button>
            </div>

            {tab === "buy" && (
              <div>
                <label className="mb-2 block text-sm text-gray-300">
                  SOL amount
                </label>

                <input
                  value={solInput}
                  onChange={(e) => setSolInput(e.target.value)}
                  placeholder="0.1"
                  className="mb-4 w-full rounded-xl border border-gray-800 bg-black px-4 py-3 text-white outline-none placeholder:text-gray-600 focus:border-white"
                />

                <button
                  onClick={handleBuy}
                  disabled={busy}
                  className="w-full rounded-xl bg-white px-6 py-4 font-semibold text-black transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? "Processing..." : "Buy"}
                </button>
              </div>
            )}

            {tab === "sell" && (
              <div>
                <label className="mb-2 block text-sm text-gray-300">
                  Token amount
                </label>

                <input
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="1000"
                  className="mb-3 w-full rounded-xl border border-gray-800 bg-black px-4 py-3 text-white outline-none placeholder:text-gray-600 focus:border-white"
                />

                <div className="mb-4 flex gap-2">
                  {SELL_PERCENT_OPTIONS.map((option) => (
                    <button
                      key={option.label}
                      type="button"
                      onClick={() =>
                        setTokenInput(
                          getSellAmountForPercent(
                            state.userTokenBalance,
                            option.percent,
                          ),
                        )
                      }
                      className="flex-1 rounded-lg border border-gray-800 py-2 text-xs font-semibold text-gray-300 transition hover:border-white hover:text-white"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                <button
                  onClick={handleSell}
                  disabled={busy}
                  className="w-full rounded-xl bg-white px-6 py-4 font-semibold text-black transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? "Processing..." : "Sell"}
                </button>
              </div>
            )}
          </div>
        )}

        {connected && error && (
          <div className="mt-5 rounded-xl border border-red-900 bg-red-950/30 p-4 text-sm text-red-400">
            {error}
          </div>
        )}

        {connected && signature && (
          <div className="mt-5 rounded-xl border border-green-900 bg-green-950/20 p-4">
            <p className="text-sm font-semibold text-green-400">
              Transaction confirmed
            </p>

            <a
              href={`https://solscan.io/tx/${signature}${SOLSCAN_CLUSTER_PARAM}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 block break-all text-xs text-blue-400 hover:text-blue-300"
            >
              {signature}
            </a>
          </div>
        )}

        {!connected && (
          <p className="text-center text-sm text-gray-500">
            Connect your wallet to trade this coin.
          </p>
        )}
      </div>
    </main>
  );
}
