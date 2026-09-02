"use client";

import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { Wallet } from "lucide-react";

import { robinhoodChain } from "../src/lib/pons/chain";

function truncate(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Robinhood Chain wallet control — the app's only wallet since it went
 * ETH-only. Handles connect, wrong-chain and connected states.
 */
export default function EvmWalletButton() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  const injected = connectors[0];

  if (!isConnected) {
    return (
      <button
        onClick={() => injected && connect({ connector: injected })}
        disabled={!injected || isPending}
        className="flex h-9 items-center gap-2 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 text-xs font-semibold text-violet-300 transition hover:bg-violet-500/20 disabled:opacity-40"
      >
        <Wallet size={14} />
        {isPending ? "Connecting..." : "Connect Wallet"}
      </button>
    );
  }

  if (chainId !== robinhoodChain.id) {
    return (
      <button
        onClick={() => switchChain({ chainId: robinhoodChain.id })}
        className="flex h-9 items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 text-xs font-semibold text-amber-300 transition hover:bg-amber-500/20"
      >
        Switch to Robinhood Chain
      </button>
    );
  }

  return (
    <button
      onClick={() => disconnect()}
      title="Disconnect"
      className="flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-xs font-medium text-zinc-300 transition hover:border-white/20"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
      {truncate(address!)}
    </button>
  );
}
