import { defineChain } from "viem";

/*
 * Robinhood Chain — Arbitrum Orbit L2 settling on Ethereum, ETH gas, ~100ms
 * blocks. Values verified against https://docs.robinhood.com/chain/connecting
 * and a live eth_chainId call (0x1237 = 4663).
 *
 * The public RPCs are rate-limited and explicitly "not recommended for
 * production" — set NEXT_PUBLIC_ROBINHOOD_RPC_URL to an Alchemy endpoint
 * before this sees real traffic.
 */

export const robinhoodChain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.mainnet.chain.robinhood.com"] },
  },
  blockExplorers: {
    default: {
      name: "Blockscout",
      url: "https://robinhoodchain.blockscout.com",
    },
  },
  // Canonical Multicall3, confirmed deployed here. Declaring it lets viem
  // batch reads into one request, which matters a great deal against an RPC
  // that throttles on request volume.
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
});

export const robinhoodChainTestnet = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.chain.robinhood.com"] },
  },
  blockExplorers: {
    default: {
      name: "Robinhood Explorer",
      url: "https://explorer.testnet.chain.robinhood.com",
    },
  },
  testnet: true,
});

export const ROBINHOOD_RPC_URL =
  process.env.NEXT_PUBLIC_ROBINHOOD_RPC_URL ||
  robinhoodChain.rpcUrls.default.http[0];

export function explorerTxUrl(hash: string): string {
  return `${robinhoodChain.blockExplorers.default.url}/tx/${hash}`;
}

export function explorerTokenUrl(address: string): string {
  return `${robinhoodChain.blockExplorers.default.url}/token/${address}`;
}
