import type { Address } from "viem";

/*
 * Pons launchpad deployment on Robinhood Chain (4663).
 *
 * Every address below was read back off-chain rather than copied from a blog
 * post: the DEX and launch parameters come from getDexConfig(0) /
 * getLaunchConfig(0) on the active factory, and the router interface was
 * confirmed by selector-probing its deployed bytecode.
 */

export const PONS_FACTORY: Address =
  "0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB";

/** Tokens launched before the active factory. Read-only for us — still tradeable. */
export const PONS_LEGACY_FACTORY: Address =
  "0x0c37a24F5D23A486FA692d1500881d698B1F77a4";

export const PONS_LOCKER: Address =
  "0x736D76699C26D0d966744cAe304C000d471f7F35";

/** dexConfig(0) — "uniswap v3" */
export const UNISWAP_V3_FACTORY: Address =
  "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA";
export const POSITION_MANAGER: Address =
  "0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3";
/** SwapRouter02 — no deadline in the exactInputSingle struct. */
export const SWAP_ROUTER: Address =
  "0xCaf681a66D020601342297493863E78C959E5cb2";
export const QUOTER_V2: Address =
  "0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7";

/** launchConfig(0).pairToken — every Pons pool is quoted in WETH. */
export const WETH: Address = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";

/** Factory start blocks; nothing was launched before these. */
export const PONS_FACTORY_START_BLOCK = 8991118n;
export const PONS_LEGACY_FACTORY_START_BLOCK = 8600612n;

/** The only DEX and launch config the factory currently exposes. */
export const DEX_ID = 0n;
export const LAUNCH_CONFIG_ID = 0n;

/** dexConfig(0).poolFee — 1%. Every Pons pool uses this tier. */
export const POOL_FEE = 10000;

/** SwapRouter02 recipient sentinels. */
export const MSG_SENDER: Address =
  "0x0000000000000000000000000000000000000001";
export const ADDRESS_THIS: Address =
  "0x0000000000000000000000000000000000000002";

export const DEFAULT_SLIPPAGE_PERCENT = 1;
