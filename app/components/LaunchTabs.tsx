"use client";

import { useState } from "react";

import Link from "next/link";
import { Check, ChevronDown, Info, Lock, Unlock, X } from "lucide-react";

import EvmWalletButton from "./EvmWalletButton";

/*
 * Switcher between the two launch routes, plus the explanation of how they
 * differ.
 *
 * Both routes end at the same place — an ERC-20 with a WETH Uniswap V3 pool on
 * Robinhood Chain. What actually differs is who holds the LP position and what
 * the Pons factory adds around it, and that was previously only discoverable
 * by reading a warning banner on one page. It lives here so both pages show
 * the same comparison.
 *
 * Deliberately presentational: it takes the active tab and the live
 * launchEnabled flag as props rather than reading the pathname or the factory
 * itself, so rendering it costs no extra RPC call.
 */

export type LaunchTab = "pons" | "direct";

const TABS = [
  {
    key: "pons" as const,
    href: "/pons/launch",
    label: "Pons",
    tag: "LP locked",
    icon: Lock,
    hint: "One transaction. The factory locks your liquidity and pays you 70% of trading fees.",
  },
  {
    key: "direct" as const,
    href: "/pons/launch/direct",
    label: "Uniswap",
    tag: "You keep LP",
    icon: Unlock,
    hint: "Three transactions. You set the price and keep the LP position NFT yourself.",
  },
];

/** Verified against the launch code paths, not marketing copy. */
const BENEFITS: Record<LaunchTab, { good: string[]; bad: string[] }> = {
  pons: {
    good: [
      "One transaction, one signature",
      "LP is locked in the Pons locker — buyers can see you cannot pull the liquidity",
      "You earn 70% of trading fees, paid to your fee wallet",
      "Anti-snipe max-wallet and max-tx limits for the first blocks",
      "Logo, description and socials are stored on-chain",
      "Appears in the Market page automatically",
    ],
    bad: [
      "Costs a launch fee on top of gas",
      "Supply, opening price and the 1% fee tier are fixed",
      "Currently disabled on-chain — only the factory owner can re-enable it",
    ],
  },
  direct: {
    good: [
      "Works right now — needs no permission from the Pons factory",
      "You choose the supply, the opening price and the fee tier (0.05% / 0.3% / 1%)",
      "No launch fee — only gas plus the ETH you seed",
      "You hold the LP position NFT and collect 100% of the trading fees",
    ],
    bad: [
      "Three transactions to sign",
      "Liquidity stays withdrawable by you, which buyers read as rug risk",
      "No anti-snipe limits and no graduation tracking",
      "Not listed in the Market page — it emits no Pons launch event",
    ],
  },
};

function BenefitList({ tab }: { tab: LaunchTab }) {
  const { good, bad } = BENEFITS[tab];

  return (
    <ul className="space-y-2">
      {good.map((item) => (
        <li key={item} className="flex gap-2 text-[13px] leading-relaxed text-zinc-300">
          <Check size={14} className="mt-0.5 shrink-0 text-emerald-400" />
          {item}
        </li>
      ))}

      {bad.map((item) => (
        <li key={item} className="flex gap-2 text-[13px] leading-relaxed text-zinc-500">
          <X size={14} className="mt-0.5 shrink-0 text-red-400/70" />
          {item}
        </li>
      ))}
    </ul>
  );
}

export default function LaunchTabs({
  active,
  ponsEnabled,
}: {
  active: LaunchTab;
  /** Live `launchEnabled` from the factory. undefined = not read on this page. */
  ponsEnabled?: boolean | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mb-8">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-1 items-center gap-1 rounded-xl border border-white/[0.08] bg-white/[0.025] p-1 sm:flex-none">
          {TABS.map((tab) => {
            const isActive = tab.key === active;
            const Icon = tab.icon;
            const disabled = tab.key === "pons" && ponsEnabled === false;

            return (
              <Link
                key={tab.key}
                href={tab.href}
                title={tab.hint}
                aria-current={isActive ? "page" : undefined}
                className={`
                  flex flex-1 items-center justify-center gap-2
                  rounded-lg px-3 py-2.5
                  text-xs font-semibold
                  transition-all duration-200
                  sm:flex-none sm:px-4
                  ${
                    isActive
                      ? "bg-white text-black shadow-sm"
                      : "text-zinc-500 hover:bg-white/[0.04] hover:text-white"
                  }
                `}
              >
                <Icon size={14} strokeWidth={2.2} />

                {tab.label}

                {/* Info tag: the one-word version of the whole difference. */}
                <span
                  className={`
                    hidden rounded-full px-2 py-0.5
                    text-[10px] font-medium tracking-tight
                    sm:inline
                    ${
                      isActive
                        ? "bg-black/10 text-black/60"
                        : "bg-white/[0.06] text-zinc-500"
                    }
                  `}
                >
                  {disabled ? "Disabled" : tab.tag}
                </span>
              </Link>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex h-11 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.025] px-3 text-xs font-medium text-zinc-400 transition hover:border-white/20 hover:text-white"
        >
          <Info size={14} />

          <span className="hidden sm:inline">
            {open ? "Hide" : "What is the difference?"}
          </span>

          <ChevronDown
            size={13}
            className={`transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>

        {/* Same row as the tabs: on its own line it left a near-empty band
            above the page heading. */}
        <div className="ml-auto">
          <EvmWalletButton />
        </div>
      </div>

      {open && (
        <div className="mt-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 sm:p-5">
          <p className="text-[13px] leading-relaxed text-zinc-400">
            Both routes produce the same thing: an ERC-20 with a WETH Uniswap V3
            pool on Robinhood Chain. The difference is{" "}
            <span className="font-semibold text-zinc-200">
              who ends up holding the liquidity position
            </span>{" "}
            — and what the Pons factory adds around it.
          </p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2 sm:gap-5">
            {TABS.map((tab) => (
              <div
                key={tab.key}
                className={`rounded-lg border p-4 ${
                  tab.key === active
                    ? "border-violet-500/30 bg-violet-500/[0.06]"
                    : "border-white/[0.06] bg-white/[0.02]"
                }`}
              >
                <div className="mb-3 flex items-center gap-2">
                  <tab.icon size={14} className="text-zinc-400" />

                  <h3 className="text-sm font-semibold text-white">
                    {tab.label}
                  </h3>

                  <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium text-zinc-400">
                    {tab.key === "pons" && ponsEnabled === false
                      ? "Disabled"
                      : tab.tag}
                  </span>
                </div>

                <BenefitList tab={tab.key} />
              </div>
            ))}
          </div>

          <p className="mt-4 border-t border-white/[0.06] pt-3 text-[12px] leading-relaxed text-zinc-500">
            <span className="font-semibold text-zinc-400">Short version:</span>{" "}
            Pons trades control for trust — locked liquidity and a fee share, but
            fixed terms. Uniswap trades trust for control — your price, your fee
            tier, your LP, and buyers can see you could withdraw it.
          </p>
        </div>
      )}
    </div>
  );
}
