"use client";

import { useEffect, useMemo, useState } from "react";

import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";

import { formatEther, isAddress, parseEther, type Address } from "viem";
import {
  useAccount,
  usePublicClient,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";

import EvmWalletButton from "../../components/EvmWalletButton";
import TokenLogo from "../../components/TokenLogo";

import { explorerTokenUrl, explorerTxUrl, robinhoodChain } from "../../src/lib/pons/chain";

import { PAGE_CONTAINER } from "../../src/ui";
import {
  buildApprove,
  buildBuy,
  buildSell,
  getAllowance,
  getTokenState,
  quoteBuy,
  quoteSell,
} from "../../src/lib/pons/trade";

type Tab = "buy" | "sell";

const SELL_PERCENTS = [10, 25, 50, 100];

export default function PonsTradePage() {
  const params = useParams<{ token: string }>();

  const token = useMemo(
    () => (isAddress(params.token) ? (params.token as Address) : null),
    [params.token],
  );

  const { address: user, isConnected, chainId } = useAccount();
  const publicClient = usePublicClient({ chainId: robinhoodChain.id });
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<Tab>("buy");
  const [amount, setAmount] = useState("");
  const [debouncedAmount, setDebouncedAmount] = useState("");
  const [error, setError] = useState("");

  const { writeContractAsync, isPending } = useWriteContract();
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const [approvalSent, setApprovalSent] = useState(false);
  const { isLoading: confirming, isSuccess: confirmed } =
    useWaitForTransactionReceipt({ hash: txHash });

  const wrongChain = isConnected && chainId !== robinhoodChain.id;

  const stateQuery = useQuery({
    queryKey: ["pons", "token", token, user],
    queryFn: () => getTokenState({ client: publicClient!, token: token!, user }),
    enabled: Boolean(token && publicClient),
    staleTime: 15_000,
    retry: 1,
  });

  const state = stateQuery.data ?? null;
  const loading = stateQuery.isLoading;

  const allowanceQuery = useQuery({
    queryKey: ["pons", "allowance", token, user],
    queryFn: () => getAllowance(publicClient!, token!, user!),
    enabled: Boolean(token && publicClient && user),
    staleTime: 15_000,
  });

  const allowance = allowanceQuery.data ?? 0n;

  // Debounce the typed amount so each keystroke is not a simulate call against
  // a rate-limited RPC. setState here is inside a timer callback, not the
  // effect body, so it does not cascade renders.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedAmount(amount), 400);

    return () => clearTimeout(timer);
  }, [amount]);

  const quoteQuery = useQuery({
    queryKey: ["pons", "quote", token, tab, debouncedAmount],
    queryFn: async () => {
      const parsed = parseEther(debouncedAmount);

      return tab === "buy"
        ? quoteBuy(publicClient!, token!, parsed)
        : quoteSell(publicClient!, token!, parsed);
    },
    enabled: Boolean(
      token && publicClient && debouncedAmount && Number(debouncedAmount) > 0,
    ),
    retry: false,
  });

  const quote = quoteQuery.data ?? null;
  const quoting = quoteQuery.isFetching;

  // Refetching is not setState, so this stays outside the compiler's rule.
  useEffect(() => {
    if (!confirmed) return;

    queryClient.invalidateQueries({ queryKey: ["pons", "token", token, user] });
    queryClient.invalidateQueries({ queryKey: ["pons", "allowance", token, user] });
  }, [confirmed, queryClient, token, user]);

  // Derived rather than stored, so no effect writes it.
  const notice = confirmed
    ? approvalSent
      ? "Approval confirmed. Press Sell to continue."
      : "Transaction confirmed."
    : txHash
      ? approvalSent
        ? "Approval sent. Confirm it, then press Sell again."
        : "Transaction sent."
      : "";

  const needsApproval =
    tab === "sell" && amount !== "" && (() => {
      try {
        return parseEther(amount) > allowance;
      } catch {
        return false;
      }
    })();

  async function submit() {
    if (!token || !publicClient || !user) return;

    setError("");

    try {
      const parsed = parseEther(amount);

      if (needsApproval) {
        const approve = buildApprove(token);

        const hash = await writeContractAsync({
          address: approve.address,
          abi: approve.abi,
          functionName: approve.functionName as "approve",
          args: approve.args as readonly [Address, bigint],
        });

        setApprovalSent(true);
        setTxHash(hash);
        return;
      }

      const write =
        tab === "buy"
          ? await buildBuy({ client: publicClient, token, user, ethAmountWei: parsed })
          : await buildSell({ client: publicClient, token, user, tokenAmount: parsed });

      const hash = await writeContractAsync({
        address: write.address,
        abi: write.abi,
        functionName: write.functionName as never,
        args: write.args as never,
        value: write.value,
      });

      setApprovalSent(false);
      setTxHash(hash);
      setAmount("");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Transaction failed.";
      setError(message.split("\n")[0]);
    }
  }

  if (!token) {
    return (
      <main className="min-h-screen bg-[#05070b] px-6 py-20 text-center text-white">
        <p className="text-zinc-400">Not a valid token address.</p>
      </main>
    );
  }

  const busy = isPending || confirming || loading;

  return (
    <main className="min-h-screen bg-[#05070b] text-white">
      <div className={PAGE_CONTAINER}>
        <div className="mb-8 flex items-center justify-between">
          <Link href="/pons" className="flex items-center gap-2 text-sm text-zinc-400 hover:text-white">
            <ArrowLeft size={15} />
            Market
          </Link>

          <EvmWalletButton />
        </div>

        {error && (
          <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {notice && (
          <div className="mb-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
            {notice}
            {txHash && (
              <a
                href={explorerTxUrl(txHash)}
                target="_blank"
                rel="noreferrer"
                className="ml-2 inline-flex items-center gap-1 underline"
              >
                View <ExternalLink size={12} />
              </a>
            )}
          </div>
        )}

        {state && (
          <div className="grid gap-6 md:grid-cols-[1fr_360px]">
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
              <div className="flex items-start gap-4">
                <TokenLogo
                  logo={state.logo}
                  symbol={state.symbol}
                  alt={state.name}
                  sizeClass="h-16 w-16"
                  rounded="rounded-xl"
                />

                <div className="min-w-0">
                  <h1 className="truncate text-2xl font-bold">{state.name}</h1>
                  <p className="text-sm text-zinc-500">{state.symbol}</p>

                  <a
                    href={explorerTokenUrl(state.token)}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-xs text-zinc-600 hover:text-zinc-400"
                  >
                    {state.token.slice(0, 10)}...{state.token.slice(-8)}
                    <ExternalLink size={11} />
                  </a>
                </div>
              </div>

              {state.description && (
                <p className="mt-4 text-sm text-zinc-400">{state.description}</p>
              )}

              <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-zinc-500">Price</dt>
                  <dd className="font-semibold text-emerald-400">
                    {state.priceEth.toExponential(4)} ETH
                  </dd>
                </div>

                <div>
                  <dt className="text-zinc-500">Market cap</dt>
                  <dd className="font-semibold">
                    {(state.priceEth * Number(state.totalSupply / 10n ** 18n)).toFixed(4)} ETH
                  </dd>
                </div>

                <div>
                  <dt className="text-zinc-500">Your balance</dt>
                  <dd className="font-semibold">
                    {Number(formatEther(state.userTokenBalance)).toLocaleString()} {state.symbol}
                  </dd>
                </div>

                <div>
                  <dt className="text-zinc-500">Status</dt>
                  <dd className="font-semibold">
                    {state.graduated ? "Graduated" : "Bonding"}
                  </dd>
                </div>
              </dl>

              {!state.graduated && (
                <div className="mt-6">
                  <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className="h-full rounded-full bg-violet-500 transition-all"
                      style={{ width: `${Math.round(state.graduationProgress * 100)}%` }}
                    />
                  </div>

                  <p className="mt-2 text-xs text-zinc-500">
                    {formatEther(state.pairedPrincipal)} / {formatEther(state.graduationThreshold)} ETH
                    toward graduation
                  </p>
                </div>
              )}

              {state.restrictionsActive && (
                <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                  Anti-snipe limits are active on this token until block{" "}
                  {state.restrictionsEndBlock.toString()}. Max wallet and max
                  transaction caps apply, so large trades will revert.
                </p>
              )}
            </div>

            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
              <div className="mb-4 grid grid-cols-2 gap-1 rounded-lg bg-white/[0.04] p-1">
                {(["buy", "sell"] as Tab[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => {
                      setTab(t);
                      setAmount("");
                    }}
                    className={`h-9 rounded-md text-sm font-semibold capitalize transition ${
                      tab === t
                        ? t === "buy"
                          ? "bg-emerald-500/20 text-emerald-300"
                          : "bg-red-500/20 text-red-300"
                        : "text-zinc-500 hover:text-zinc-300"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>

              <label className="text-xs text-zinc-500">
                {tab === "buy" ? "You pay (ETH)" : `You sell (${state.symbol})`}
              </label>

              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.0"
                inputMode="decimal"
                className="mt-1 h-11 w-full rounded-lg border border-white/10 bg-black/40 px-3 text-sm outline-none focus:border-violet-500/50"
              />

              {tab === "sell" && state.userTokenBalance > 0n && (
                <div className="mt-2 grid grid-cols-4 gap-1">
                  {SELL_PERCENTS.map((p) => (
                    <button
                      key={p}
                      onClick={() =>
                        setAmount(
                          formatEther((state.userTokenBalance * BigInt(p)) / 100n),
                        )
                      }
                      className="h-7 rounded-md border border-white/10 text-[11px] text-zinc-400 hover:border-white/25 hover:text-white"
                    >
                      {p === 100 ? "Max" : `${p}%`}
                    </button>
                  ))}
                </div>
              )}

              <div className="mt-4 rounded-lg bg-white/[0.03] px-3 py-2 text-xs text-zinc-400">
                {quoting
                  ? "Quoting..."
                  : quote !== null
                    ? `You receive ~${Number(formatEther(quote)).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${tab === "buy" ? state.symbol : "ETH"}`
                    : "Enter an amount for a quote"}
              </div>

              {state.graduated ? (
                <p className="mt-4 text-center text-xs text-zinc-500">
                  This token has graduated. Trading continues in its Uniswap V3
                  pool.
                </p>
              ) : null}

              <div className="mt-4">
                {!isConnected ? (
                  <EvmWalletButton />
                ) : wrongChain ? (
                  <EvmWalletButton />
                ) : (
                  <button
                    onClick={submit}
                    disabled={busy || !amount || Number(amount) <= 0}
                    className={`h-11 w-full rounded-lg text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                      tab === "buy"
                        ? "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
                        : "bg-red-500/20 text-red-300 hover:bg-red-500/30"
                    }`}
                  >
                    {busy
                      ? "Working..."
                      : needsApproval
                        ? `Approve ${state.symbol}`
                        : tab === "buy"
                          ? "Buy"
                          : "Sell"}
                  </button>
                )}
              </div>

              <p className="mt-3 text-center text-[11px] text-zinc-600">
                1% pool fee · 1% slippage tolerance
              </p>
            </div>
          </div>
        )}

        {loading && !state && (
          <div className="h-64 animate-pulse rounded-2xl border border-white/[0.08] bg-white/[0.02]" />
        )}

        {/* Neither loading nor loaded means the read failed. Without this the
            page rendered an empty shell for any address that is not a Pons
            token, with nothing to say why. */}
        {!loading && !state && stateQuery.isError && (
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-6 py-16 text-center">
            <p className="text-zinc-400">
              This address is not a Pons token on {robinhoodChain.name}.
            </p>

            <p className="mt-2 text-sm text-zinc-600">
              {stateQuery.error instanceof Error
                ? stateQuery.error.message
                : "The token could not be read from the chain."}
            </p>

            <button
              onClick={() => stateQuery.refetch()}
              className="mt-6 h-9 rounded-lg border border-white/10 bg-white/[0.03] px-4 text-xs font-medium text-zinc-300 transition hover:border-white/20"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
