"use client";

import dynamic from "next/dynamic";

const WalletMultiButton = dynamic(
  async () => {
    const mod = await import("@solana/wallet-adapter-react-ui");

    return mod.WalletMultiButton;
  },
  {
    ssr: false,
  },
);

export default function SolanaWalletButton() {
  return <WalletMultiButton />;
}
