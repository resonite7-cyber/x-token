"use client";

import { useState } from "react";

import { useQuery } from "@tanstack/react-query";

import Link from "next/link";
import { ExternalLink, Rocket } from "lucide-react";

import { formatEther, parseEther } from "viem";
import {
  useAccount,
  usePublicClient,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";

import EvmWalletButton from "../../components/EvmWalletButton";
import LaunchTabs from "../../components/LaunchTabs";

import { explorerTxUrl, robinhoodChain } from "../../src/lib/pons/chain";

import { PAGE_CONTAINER } from "../../src/ui";
import {
  buildLaunch,
  getLaunchFee,
  isLaunchEnabled,
  type LaunchParams,
} from "../../src/lib/pons/trade";

export default function PonsLaunchPage() {
  const { address: user, isConnected, chainId } = useAccount();
  const publicClient = usePublicClient({ chainId: robinhoodChain.id });

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [twitter, setTwitter] = useState("");
  const [telegram, setTelegram] = useState("");
  const [website, setWebsite] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [devBuy, setDevBuy] = useState("");

  const [stage, setStage] = useState("");
  const [error, setError] = useState("");

  const { writeContractAsync, isPending } = useWriteContract();
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const { isLoading: confirming, isSuccess: confirmed } =
    useWaitForTransactionReceipt({ hash: txHash });

  // launchEnabled is read live rather than assumed: the factory owner can flip
  // it at any time, and it is currently false on mainnet.
  const factoryQuery = useQuery({
    queryKey: ["pons", "factory"],
    queryFn: async () => {
      const [fee, on] = await Promise.all([
        getLaunchFee(publicClient!),
        isLaunchEnabled(publicClient!),
      ]);

      return { launchFee: fee, enabled: on };
    },
    enabled: Boolean(publicClient),
    staleTime: 60_000,
  });

  const launchFee = factoryQuery.data?.launchFee ?? null;

  // Deliberately tri-state: true, false, or null when the factory could not be
  // read at all. Anything other than a confirmed true keeps the button off —
  // failing open here would offer a launch that is certain to revert.
  const enabled = factoryQuery.data?.enabled ?? null;

  async function launch() {
    if (!publicClient || !user) return;

    setError("");
    setStage("");

    if (!name.trim() || !symbol.trim() || !description.trim() || !image) {
      setError("Name, symbol, description and image are all required.");
      return;
    }

    try {
      // Pons keeps logo/description/socials on-chain, so only the image needs
      // hosting — no metadata JSON document like the Solana side builds.
      setStage("Uploading image...");

      const form = new FormData();
      form.set("image", image);
      form.set("name", name);
      form.set("symbol", symbol);
      form.set("description", description);
      if (twitter) form.set("twitter", twitter);
      if (telegram) form.set("telegram", telegram);
      if (website) form.set("website", website);

      const uploaded = await fetch("/api/metadata", { method: "POST", body: form })
        .then((r) => r.json());

      if (!uploaded.success || !uploaded.imageUri) {
        throw new Error(uploaded.message || "Image upload failed.");
      }

      setStage("Building launch transaction...");

      const params: LaunchParams = {
        name: name.trim(),
        symbol: symbol.trim().toUpperCase(),
        logo: uploaded.imageUri,
        description: description.trim(),
        socials: { twitter, telegram, website },
        feeWallet: user,
        initialBuyWei: devBuy ? parseEther(devBuy) : 0n,
      };

      const { write } = await buildLaunch({ client: publicClient, params });

      setStage("Waiting for wallet signature...");

      const hash = await writeContractAsync({
        address: write.address,
        abi: write.abi as never,
        functionName: write.functionName as never,
        args: write.args as never,
        value: write.value,
      });

      setTxHash(hash);
      setStage("Launch submitted.");

    } catch (e) {
      setError(e instanceof Error ? e.message.split("\n")[0] : "Launch failed.");
      setStage("");
    }
  }

  const busy = isPending || confirming;
  const wrongChain = isConnected && chainId !== robinhoodChain.id;

  return (
    <main className="min-h-screen bg-[#05070b] text-white">
      <div className={PAGE_CONTAINER}>
        <LaunchTabs active="pons" ponsEnabled={enabled} />

        <h1 className="text-3xl font-bold tracking-tight">Launch on Pons</h1>

        <p className="mt-3 text-zinc-400">
          Deploys a fixed 1,000,000,000 supply ERC-20 into a Uniswap V3 pool on
          Robinhood Chain and locks the liquidity position, all in one
          transaction.
        </p>

        {enabled === null && (
          <div className="mt-6 rounded-xl border border-zinc-500/30 bg-zinc-500/10 px-4 py-3 text-sm text-zinc-300">
            {factoryQuery.isError ? (
              <>
                <strong className="font-semibold">Could not read the Pons factory.</strong>{" "}
                The RPC did not answer, so whether launches are enabled is
                unknown and the button stays disabled.{" "}
                <button onClick={() => factoryQuery.refetch()} className="underline">
                  Retry
                </button>
              </>
            ) : (
              "Checking whether the Pons factory is accepting launches..."
            )}
          </div>
        )}

        {enabled === false && (
          <div className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
            <strong className="font-semibold">Launches are disabled on-chain.</strong>{" "}
            The Pons factory currently reports <code>launchEnabled = false</code>,
            so any launch will revert and only its owner can change that. The
            button below stays disabled until they do. Trading existing tokens
            is unaffected. Use the{" "}
            <Link
              href="/pons/launch/direct"
              className="font-semibold text-amber-200 underline"
            >
              Uniswap
            </Link>{" "}
            tab above to launch anyway.
          </div>
        )}

        {error && (
          <div className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {(confirmed ? "Launched." : stage) && (
          <div className="mt-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
            {confirmed ? "Launched." : stage}
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

        <div className="mt-8 space-y-4 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" value={name} onChange={setName} placeholder="My Token" />
            <Field label="Symbol" value={symbol} onChange={setSymbol} placeholder="MTK" />
          </div>

          <div>
            <label className="text-xs text-zinc-500">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-violet-500/50"
            />
          </div>

          <div>
            <label className="text-xs text-zinc-500">Image</label>
            <input
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              onChange={(e) => setImage(e.target.files?.[0] ?? null)}
              className="mt-1 w-full text-sm text-zinc-400 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-xs file:text-zinc-200"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Twitter" value={twitter} onChange={setTwitter} placeholder="@handle" />
            <Field label="Telegram" value={telegram} onChange={setTelegram} placeholder="t.me/..." />
            <Field label="Website" value={website} onChange={setWebsite} placeholder="https://" />
          </div>

          <Field
            label="Dev buy (ETH, optional)"
            value={devBuy}
            onChange={setDevBuy}
            placeholder="0.0"
          />

          <div className="rounded-lg bg-white/[0.03] px-3 py-2 text-xs text-zinc-400">
            Launch fee:{" "}
            {launchFee === null ? "..." : `${formatEther(launchFee)} ETH`}
            {devBuy && ` + ${devBuy} ETH dev buy`}
          </div>

          {!isConnected || wrongChain ? (
            <EvmWalletButton />
          ) : (
            <button
              onClick={launch}
              disabled={busy || enabled !== true}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-violet-500/20 text-sm font-semibold text-violet-300 transition hover:bg-violet-500/30 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Rocket size={15} />
              {busy ? "Launching..." : "Launch token"}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="text-xs text-zinc-500">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 h-10 w-full rounded-lg border border-white/10 bg-black/40 px-3 text-sm outline-none focus:border-violet-500/50"
      />
    </div>
  );
}
