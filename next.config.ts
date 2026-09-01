import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: [
    "@coral-xyz/anchor",
    "@pump-fun/pump-sdk",
    "@pump-fun/pump-swap-sdk",
  ],
};

export default nextConfig;
