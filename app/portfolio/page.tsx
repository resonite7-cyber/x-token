"use client";

import { useEffect, useState } from "react";

import { useRouter } from "next/navigation";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";

import { PublicKey } from "@solana/web3.js";

import {
  Wallet,
  Copy,
  ExternalLink,
  Coins,
  ShoppingCart,
  ArrowDownToLine,
  Rocket,
  Check,
  ArrowUpRight,
  ArrowDownLeft,
} from "lucide-react";

import SolanaWalletButton from "../components/SolanaWalletButton";

import {
  getMintTradeState,
  getWalletTradeHistory,
  type TradeHistoryEntry,
} from "../src/lib/pumpTrade";

interface CreatedCoin {
  name: string;
  symbol: string;
  mint: string;
  creatorWallet: string;
  createdAt: string;
  image?: string;
}

type Holding = {
  mint: string;
  name: string;
  symbol: string;
  image?: string;
  balance: string;
  priceSol: number;
  valueSol: number;
  graduated: boolean;
  createdByUser: boolean;
};

const SOLANA_RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

const SOLSCAN_CLUSTER_PARAM = SOLANA_RPC_URL.includes("devnet")
  ? "?cluster=devnet"
  : SOLANA_RPC_URL.includes("testnet")
    ? "?cluster=testnet"
    : "";

function tokenAmountToUi(rawAmount: string, decimals = 6) {
  const value = Number(rawAmount) / 10 ** decimals;

  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function PortfolioPage() {
  const router = useRouter();

  const { publicKey, connected } = useWallet();

  const { connection } = useConnection();

  const [activeTab, setActiveTab] = useState<
    "holdings" | "created" | "history"
  >("holdings");

  const [copied, setCopied] = useState(false);

  const [allCoins, setAllCoins] = useState<CreatedCoin[]>([]);

  const [coinsLoading, setCoinsLoading] = useState(true);

  const [holdings, setHoldings] = useState<Holding[]>([]);

  const [holdingsLoading, setHoldingsLoading] = useState(false);

  const [solBalance, setSolBalance] = useState<number | null>(null);

  const [history, setHistory] = useState<TradeHistoryEntry[]>([]);

  const [historyLoading, setHistoryLoading] = useState(false);

  const [historyError, setHistoryError] = useState(false);

  const [historyFetchedFor, setHistoryFetchedFor] = useState<string | null>(
    null,
  );

  const walletAddress = publicKey?.toBase58() ?? "";

  useEffect(() => {
    fetch("/api/coins")
      .then((res) => (res.ok ? res.json() : { coins: [] }))
      .then((data) => setAllCoins(data.coins ?? []))
      .catch(() => setAllCoins([]))
      .finally(() => setCoinsLoading(false));
  }, []);

  useEffect(() => {
    if (!connected || !publicKey) {
      return;
    }

    let cancelled = false;

    connection
      .getBalance(publicKey)
      .then((lamports) => {
        if (!cancelled) setSolBalance(lamports / 1e9);
      })
      .catch(() => {
        if (!cancelled) setSolBalance(null);
      });

    return () => {
      cancelled = true;
    };
  }, [connection, connected, publicKey]);

  useEffect(() => {
    if (!connected || !publicKey) {
      return;
    }

    if (allCoins.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resets stale holdings when the coin list becomes empty (e.g. refetch)
      setHoldings([]);
      return;
    }

    let cancelled = false;

    setHoldingsLoading(true);

    Promise.all(
      allCoins.map(async (coin) => {
        try {
          const mint = new PublicKey(coin.mint);

          const state = await getMintTradeState({
            connection,
            mint,
            user: publicKey,
          });

          if (state.userTokenBalance === "0") {
            return null;
          }

          const balanceUi = Number(state.userTokenBalance) / 1e6;

          const holding: Holding = {
            mint: coin.mint,
            name: coin.name,
            symbol: coin.symbol,
            image: coin.image,
            balance: tokenAmountToUi(state.userTokenBalance),
            priceSol: state.priceSol,
            valueSol: balanceUi * state.priceSol,
            graduated: state.graduated,
            createdByUser: coin.creatorWallet === publicKey.toBase58(),
          };

          return holding;
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      if (!cancelled) {
        setHoldings(results.filter((h): h is Holding => h !== null));
        setHoldingsLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [connection, connected, publicKey, allCoins]);

  useEffect(() => {
    if (
      activeTab !== "history" ||
      !connected ||
      !publicKey ||
      historyFetchedFor === publicKey.toBase58()
    ) {
      return;
    }

    let cancelled = false;

    const walletAddress = publicKey.toBase58();

    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading flags for an in-flight fetch triggered by this effect
    setHistoryLoading(true);
    setHistoryError(false);

    getWalletTradeHistory({ connection, user: publicKey })
      .then((entries) => {
        if (!cancelled) {
          setHistory(entries);
          setHistoryFetchedFor(walletAddress);
        }
      })
      .catch(() => {
        if (!cancelled) setHistoryError(true);
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, connection, connected, publicKey, historyFetchedFor]);

  const createdTokens = connected && publicKey
    ? allCoins.filter((coin) => coin.creatorWallet === publicKey.toBase58())
    : [];

  const coinsByMint = new Map(allCoins.map((coin) => [coin.mint, coin]));

  const portfolioValueSol =
    (solBalance ?? 0) + holdings.reduce((sum, h) => sum + h.valueSol, 0);

  const copyWallet = async () => {
    await navigator.clipboard.writeText(walletAddress);

    setCopied(true);

    setTimeout(() => {
      setCopied(false);
    }, 1500);
  };

  const goToBuy = (mint: string) => {
    router.push(`/trade/${mint}?side=buy`);
  };

  const goToSell = (mint: string) => {
    router.push(`/trade/${mint}?side=sell`);
  };

  const goToTrade = (mint: string) => {
    router.push(`/trade/${mint}`);
  };

  if (!connected) {
    return (
      <main className="min-h-screen bg-[#05070b] text-white">
        <div className="mx-auto max-w-[1100px] px-5 py-10 lg:px-8">
          <div className="mb-8">
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              My Portfolio
            </h1>

            <p className="mt-2 text-sm text-zinc-500">
              Manage your tokens and trades
            </p>
          </div>

          <div className="rounded-2xl border border-white/[0.08] bg-[#090c12] p-10 text-center">
            <p className="mb-5 text-sm text-zinc-400">
              Connect your wallet to view your portfolio.
            </p>

            <div className="flex justify-center">
              <SolanaWalletButton />
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#05070b] text-white">
      <div className="mx-auto max-w-[1100px] px-5 py-10 lg:px-8">
        {/* PAGE TITLE */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            My Portfolio
          </h1>

          <p className="mt-2 text-sm text-zinc-500">
            Manage your tokens and trades
          </p>
        </div>

        {/* WALLET SUMMARY */}
        <section className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-br from-[#11131c] to-[#090b10] p-6">
          <div className="pointer-events-none absolute -right-20 -top-20 h-48 w-48 rounded-full bg-violet-600/10 blur-3xl" />

          <div className="relative">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10 text-violet-400">
                <Wallet size={16} />
              </div>

              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Wallet
              </span>
            </div>

            {/* WALLET ADDRESS */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm text-zinc-300">
                {walletAddress.slice(0, 6)}...
                {walletAddress.slice(-6)}
              </span>

              <button
                onClick={copyWallet}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-white/[0.08] bg-white/[0.03] text-zinc-500 transition hover:bg-white/[0.08] hover:text-white"
              >
                {copied ? (
                  <Check size={13} className="text-green-400" />
                ) : (
                  <Copy size={13} />
                )}
              </button>

              <a
                href={`https://solscan.io/account/${walletAddress}${SOLSCAN_CLUSTER_PARAM}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-7 w-7 items-center justify-center rounded-md border border-white/[0.08] bg-white/[0.03] text-zinc-500 transition hover:bg-white/[0.08] hover:text-white"
              >
                <ExternalLink size={13} />
              </a>
            </div>

            {/* PORTFOLIO VALUE */}
            <div className="mt-7">
              <p className="text-xs text-zinc-500">Portfolio Value</p>

              <div className="mt-1 flex items-end gap-3">
                <span className="text-3xl font-bold">
                  {portfolioValueSol.toFixed(4)} SOL
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* SUMMARY CARDS */}
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <SummaryCard
            icon={<Wallet size={18} />}
            label="SOL Balance"
            value={solBalance !== null ? `${solBalance.toFixed(4)} SOL` : "..."}
          />

          <SummaryCard
            icon={<Coins size={18} />}
            label="Tokens"
            value={`${holdings.length} Asset${holdings.length === 1 ? "" : "s"}`}
          />
        </div>

        {/* TABS */}
        <section className="mt-8">
          <div className="flex border-b border-white/[0.08]">
            <button
              onClick={() => setActiveTab("holdings")}
              className={`
                relative px-5 pb-4 pt-2
                text-sm font-semibold
                transition
                ${
                  activeTab === "holdings"
                    ? "text-white"
                    : "text-zinc-500 hover:text-zinc-300"
                }
              `}
            >
              Holdings
              {activeTab === "holdings" && (
                <span className="absolute bottom-[-1px] left-0 right-0 h-[2px] rounded-full bg-violet-500" />
              )}
            </button>

            <button
              onClick={() => setActiveTab("created")}
              className={`
                relative px-5 pb-4 pt-2
                text-sm font-semibold
                transition
                ${
                  activeTab === "created"
                    ? "text-white"
                    : "text-zinc-500 hover:text-zinc-300"
                }
              `}
            >
              Created
              {activeTab === "created" && (
                <span className="absolute bottom-[-1px] left-0 right-0 h-[2px] rounded-full bg-violet-500" />
              )}
            </button>

            <button
              onClick={() => setActiveTab("history")}
              className={`
                relative px-5 pb-4 pt-2
                text-sm font-semibold
                transition
                ${
                  activeTab === "history"
                    ? "text-white"
                    : "text-zinc-500 hover:text-zinc-300"
                }
              `}
            >
              History
              {activeTab === "history" && (
                <span className="absolute bottom-[-1px] left-0 right-0 h-[2px] rounded-full bg-violet-500" />
              )}
            </button>
          </div>

          {/* =================================================
              HOLDINGS
          ================================================= */}

          {activeTab === "holdings" && (
            <div className="pt-6">
              <div className="mb-5">
                <h2 className="text-base font-semibold">Tokens you own</h2>

                <p className="mt-1 text-xs text-zinc-500">
                  Buy more or sell tokens from your wallet.
                </p>
              </div>

              {(coinsLoading || holdingsLoading) && (
                <p className="text-sm text-zinc-500">Loading...</p>
              )}

              {!coinsLoading && !holdingsLoading && holdings.length === 0 && (
                <p className="text-sm text-zinc-500">
                  You don&apos;t hold any tokens from this app yet.
                </p>
              )}

              <div className="space-y-3">
                {holdings.map((token) => (
                  <HoldingCard
                    key={token.mint}
                    token={token}
                    onBuy={() => goToBuy(token.mint)}
                    onSell={() => goToSell(token.mint)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* =================================================
              CREATED
          ================================================= */}

          {activeTab === "created" && (
            <div className="pt-6">
              <div className="mb-5">
                <h2 className="text-base font-semibold">Coins you created</h2>

                <p className="mt-1 text-xs text-zinc-500">
                  Tokens launched from your wallet.
                </p>
              </div>

              {coinsLoading && (
                <p className="text-sm text-zinc-500">Loading...</p>
              )}

              {!coinsLoading && createdTokens.length === 0 && (
                <p className="text-sm text-zinc-500">
                  You haven&apos;t created any tokens yet.
                </p>
              )}

              <div className="space-y-3">
                {createdTokens.map((token) => (
                  <CreatedCard
                    key={token.mint}
                    token={token}
                    onTrade={() => goToTrade(token.mint)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* =================================================
              HISTORY
          ================================================= */}

          {activeTab === "history" && (
            <div className="pt-6">
              <div className="mb-5">
                <h2 className="text-base font-semibold">
                  Transaction history
                </h2>

                <p className="mt-1 text-xs text-zinc-500">
                  Your recent buys and sells on the bonding curve.
                </p>
              </div>

              {historyLoading && (
                <p className="text-sm text-zinc-500">Loading...</p>
              )}

              {!historyLoading && historyError && (
                <p className="text-sm text-red-400">
                  Failed to load transaction history.
                </p>
              )}

              {!historyLoading && !historyError && history.length === 0 && (
                <p className="text-sm text-zinc-500">
                  No recent buy/sell transactions found for this wallet.
                </p>
              )}

              {!historyLoading && !historyError && history.length > 0 && (
                <div className="space-y-3">
                  {history.map((entry) => (
                    <HistoryRow
                      key={entry.signature}
                      entry={entry}
                      coin={coinsByMint.get(entry.mint)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

/* =========================================================
   SUMMARY CARD
========================================================= */

function SummaryCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-white/[0.08] bg-[#090c12] p-5">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/[0.04] text-zinc-400">
        {icon}
      </div>

      <div>
        <p className="text-xs text-zinc-500">{label}</p>

        <p className="mt-1 text-lg font-bold">{value}</p>
      </div>
    </div>
  );
}

/* =========================================================
   HOLDING CARD
========================================================= */

function HoldingCard({
  token,
  onBuy,
  onSell,
}: {
  token: Holding;
  onBuy: () => void;
  onSell: () => void;
}) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#090c12] p-5 transition hover:border-white/[0.14]">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        {/* TOKEN INFO */}
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.03] text-2xl">
            {token.image ? (
              // eslint-disable-next-line @next/next/no-img-element -- arbitrary user-supplied metadata URIs, not local/optimizable assets
              <img
                src={token.image}
                alt={token.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <Coins size={20} className="text-zinc-600" />
            )}
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">{token.name}</h3>

              <span className="text-xs font-medium text-zinc-500">
                ${token.symbol}
              </span>

              {token.createdByUser && (
                <span className="rounded-md border border-violet-500/20 bg-violet-500/10 px-2 py-1 text-[10px] font-semibold text-violet-400">
                  Created by you
                </span>
              )}

              {token.graduated && (
                <span className="rounded-md border border-yellow-500/20 bg-yellow-500/10 px-2 py-1 text-[10px] font-semibold text-yellow-400">
                  Migrated
                </span>
              )}
            </div>

            <p className="mt-1 font-mono text-[11px] text-zinc-600">
              {token.mint.slice(0, 6)}...
              {token.mint.slice(-6)}
            </p>
          </div>
        </div>

        {/* BALANCE */}
        <div className="lg:min-w-[180px]">
          <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">
            Balance
          </p>

          <p className="mt-1 text-lg font-bold">
            {token.balance}{" "}
            <span className="text-sm font-medium text-zinc-500">
              {token.symbol}
            </span>
          </p>

          <p className="mt-0.5 text-xs text-zinc-500">
            ≈ {token.valueSol.toFixed(6)} SOL
          </p>
        </div>

        {/* ACTIONS */}
        <div className="flex shrink-0 gap-2">
          <button
            onClick={onBuy}
            disabled={token.graduated}
            className="flex h-10 items-center justify-center gap-2 rounded-lg border border-violet-500/30 bg-violet-500/10 px-4 text-xs font-semibold text-violet-300 transition hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ShoppingCart size={14} />
            Buy More
          </button>

          <button
            onClick={onSell}
            disabled={token.graduated}
            className="flex h-10 items-center justify-center gap-2 rounded-lg border border-white/[0.1] bg-white/[0.03] px-4 text-xs font-semibold text-zinc-300 transition hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowDownToLine size={14} />
            Sell
          </button>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   CREATED CARD
========================================================= */

function CreatedCard({
  token,
  onTrade,
}: {
  token: CreatedCoin;
  onTrade: () => void;
}) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#090c12] p-5 transition hover:border-white/[0.14]">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        {/* TOKEN */}
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.03] text-2xl">
            {token.image ? (
              // eslint-disable-next-line @next/next/no-img-element -- arbitrary user-supplied metadata URIs, not local/optimizable assets
              <img
                src={token.image}
                alt={token.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <Coins size={20} className="text-zinc-600" />
            )}
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold">{token.name}</h3>

              <span className="text-xs text-zinc-500">${token.symbol}</span>
            </div>

            <p className="mt-1 font-mono text-[11px] text-zinc-600">
              {token.mint.slice(0, 6)}...
              {token.mint.slice(-6)}
            </p>

            <p className="mt-1 text-[11px] text-zinc-600">
              Created {new Date(token.createdAt).toLocaleString()}
            </p>
          </div>
        </div>

        {/* ACTIONS */}
        <div className="flex shrink-0 gap-2">
          <a
            href={`https://solscan.io/token/${token.mint}${SOLSCAN_CLUSTER_PARAM}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-10 items-center justify-center rounded-lg border border-white/[0.1] bg-white/[0.03] px-4 text-xs font-semibold text-zinc-300 transition hover:bg-white/[0.08] hover:text-white"
          >
            View
          </a>

          <button
            onClick={onTrade}
            className="flex h-10 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 px-4 text-xs font-semibold text-white transition hover:opacity-90"
          >
            Trade
            <Rocket size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   HISTORY ROW
========================================================= */

function HistoryRow({
  entry,
  coin,
}: {
  entry: TradeHistoryEntry;
  coin?: CreatedCoin;
}) {
  const name = coin?.name ?? "Unknown coin";
  const symbol = coin?.symbol ?? `${entry.mint.slice(0, 4)}...`;

  const tokenAmountUi = tokenAmountToUi(entry.tokenAmount);

  const timestamp = entry.blockTime
    ? new Date(entry.blockTime * 1000).toLocaleString()
    : "Unknown time";

  return (
    <a
      href={`https://solscan.io/tx/${entry.signature}${SOLSCAN_CLUSTER_PARAM}`}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-between gap-4 rounded-xl border border-white/[0.08] bg-[#090c12] p-5 transition hover:border-white/[0.14]"
    >
      <div className="flex min-w-0 items-center gap-4">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
            entry.isBuy
              ? "bg-emerald-500/10 text-emerald-400"
              : "bg-red-500/10 text-red-400"
          }`}
        >
          {entry.isBuy ? (
            <ArrowDownLeft size={18} />
          ) : (
            <ArrowUpRight size={18} />
          )}
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`text-xs font-semibold ${
                entry.isBuy ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {entry.isBuy ? "Buy" : "Sell"}
            </span>

            <h3 className="font-semibold">{name}</h3>

            <span className="text-xs font-medium text-zinc-500">
              ${symbol}
            </span>
          </div>

          <p className="mt-1 text-xs text-zinc-500">{timestamp}</p>
        </div>
      </div>

      <div className="shrink-0 text-right">
        <p className="text-sm font-bold">{entry.solAmount.toFixed(6)} SOL</p>

        <p className="mt-0.5 text-xs text-zinc-500">
          {tokenAmountUi} {symbol}
        </p>
      </div>
    </a>
  );
}
