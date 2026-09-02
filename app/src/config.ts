import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";

import { robinhoodChain, ROBINHOOD_RPC_URL } from "./lib/pons/chain";

/*
 * Robinhood Chain is the EVM target now that Pons trading lives here. Base
 * Sepolia was scaffolding from create-next-app and had no code path behind it.
 *
 * MAINNET ONLY (chain 4663). Testnet 46630 was listed here but is empty for
 * our purposes: no Pons factory, no Uniswap V3, no WETH — only Multicall3.
 * Listing it made wagmi treat a wallet on 46630 as a supported chain, so the
 * UI offered no "switch network" prompt while every read failed. The chain
 * definition stays exported from ./lib/pons/chain for reference.
 */
export const config = createConfig({
  chains: [robinhoodChain],

  connectors: [injected()],

  transports: {
    [robinhoodChain.id]: http(ROBINHOOD_RPC_URL),
  },

  ssr: true,
});
