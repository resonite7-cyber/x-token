"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Rocket, ArrowLeftRight, PieChart } from "lucide-react";

import EvmWalletButton from "./EvmWalletButton";
import { robinhoodChain } from "../src/lib/pons/chain";
import { PAGE_MAX_WIDTH } from "../src/ui";

const NAV_LINKS = [
  {
    href: "/pons",
    label: "Market",
    icon: ArrowLeftRight,
  },
  {
    href: "/pons/launch",
    label: "Launch",
    icon: Rocket,
  },
  {
    href: "/portfolio",
    label: "Portfolio",
    icon: PieChart,
  },
];

function matches(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

/*
 * Only the most specific link highlights. Prefix matching alone cannot tell a
 * parent from a child, so on /pons/launch both "/pons" and "/pons/launch"
 * matched and both tabs lit up. The longest matching href wins instead.
 */
function activeHref(pathname: string) {
  return NAV_LINKS.filter((link) => matches(pathname, link.href)).sort(
    (a, b) => b.href.length - a.href.length,
  )[0]?.href;
}

export default function Navbar() {
  const pathname = usePathname();
  const current = activeHref(pathname);

  return (
    <nav className="sticky top-0 z-50 border-b border-white/[0.08] bg-[#05070b]/90 backdrop-blur-xl">
      <div className={`mx-auto flex h-[68px] w-full ${PAGE_MAX_WIDTH} items-center justify-between px-6`}>
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
            const active = link.href === current;
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
            {robinhoodChain.name}
          </div>

          {/* Wallet */}
          <EvmWalletButton />
        </div>
      </div>
    </nav>
  );
}
