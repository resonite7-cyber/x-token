"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Rocket,
  ArrowLeftRight,
  Briefcase,
  Wallet,
  ChevronDown,
} from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";

function truncateAddress(address: string) {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

const NAV_LINKS = [
  {
    href: "/trade",
    label: "Market",
    icon: ArrowLeftRight,
  },
  {
    href: "/portfolio",
    label: "Portfolio",
    icon: Briefcase,
  },
  {
    href: "/",
    label: "Create Token",
    icon: Rocket,
  },
];

function isActive(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function Navbar() {
  const pathname = usePathname();

  const { publicKey, connected, disconnect } = useWallet();

  const { setVisible } = useWalletModal();

  const handleWalletClick = () => {
    if (connected) {
      disconnect();
    } else {
      setVisible(true);
    }
  };

  return (
    <nav className="sticky top-0 z-50 border-b border-white/[0.08] bg-[#05070b]/90 backdrop-blur-xl">
      <div className="mx-auto flex h-[68px] max-w-[1280px] items-center justify-between px-5 lg:px-8">
        {/* =====================================================
            LOGO
        ===================================================== */}

        <Link href="/" className="group flex items-center gap-3">
          <div
            className="
              flex h-9 w-9 items-center justify-center
              rounded-xl
              bg-gradient-to-br from-violet-600 to-indigo-600
              text-lg
              shadow-lg shadow-violet-900/20
              transition
              group-hover:scale-105
            "
          >
            🚀
          </div>

          <div className="hidden sm:block">
            <div className="text-[15px] font-bold tracking-tight text-white">
              X-TOKEN
            </div>

            <div className="text-[9px] font-medium uppercase tracking-[0.18em] text-zinc-600">
              Token Launcher
            </div>
          </div>
        </Link>

        {/* =====================================================
            NAVIGATION
        ===================================================== */}

        <div
          className="
            absolute left-1/2
            hidden -translate-x-1/2
            items-center gap-1
            rounded-xl
            border border-white/[0.08]
            bg-white/[0.025]
            p-1
            md:flex
          "
        >
          {NAV_LINKS.map((link) => {
            const active = isActive(pathname, link.href);
            const Icon = link.icon;

            return (
              <Link
                key={link.href}
                href={link.href}
                className={`
                  relative flex items-center gap-2
                  rounded-lg
                  px-4 py-2.5
                  text-xs font-semibold
                  transition-all duration-200
                  ${
                    active
                      ? "bg-white text-black shadow-sm"
                      : "text-zinc-500 hover:bg-white/[0.04] hover:text-white"
                  }
                `}
              >
                <Icon size={14} strokeWidth={2.2} />

                {link.label}
              </Link>
            );
          })}
        </div>

        {/* =====================================================
            RIGHT SIDE
        ===================================================== */}

        <div className="flex items-center gap-3">
          {/* Network */}
          <div
            className="
              hidden items-center gap-2
              rounded-lg
              border border-white/[0.08]
              bg-white/[0.025]
              px-3 py-2
              text-[11px] font-medium
              text-zinc-400
              sm:flex
            "
          >
            <span className="h-1.5 w-1.5 rounded-full bg-green-400 shadow-sm shadow-green-400/50" />
            Devnet
          </div>

          {/* Wallet */}
          <button
            onClick={handleWalletClick}
            className="
              flex items-center gap-2
              rounded-lg
              border border-violet-500/30
              bg-violet-500/10
              px-3.5 py-2.5
              text-xs font-semibold
              text-violet-300
              transition
              hover:border-violet-500/50
              hover:bg-violet-500/15
              hover:text-white
            "
          >
            <Wallet size={14} />

            <span className="hidden sm:inline">
              {connected && publicKey
                ? truncateAddress(publicKey.toBase58())
                : "Connect Wallet"}
            </span>

            <span className="sm:hidden">
              {connected && publicKey
                ? truncateAddress(publicKey.toBase58())
                : "Wallet"}
            </span>

            <ChevronDown
              size={13}
              className="hidden sm:block text-violet-500"
            />
          </button>
        </div>
      </div>
    </nav>
  );
}
