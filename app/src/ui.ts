/*
 * Shared layout widths.
 *
 * Pages had drifted to four different container widths (2xl on the launch
 * pages, 4xl on the token page, 6xl on the market and portfolio) plus a fifth
 * on the navbar, so content jumped horizontally on every navigation. One
 * constant instead, used by every page and the navbar.
 */

/** The column every page frames its content in. Matches the navbar. */
export const PAGE_MAX_WIDTH = "max-w-6xl";

/** Standard page container: the shared column, with the standard gutters. */
export const PAGE_CONTAINER = `mx-auto w-full ${PAGE_MAX_WIDTH} px-6 py-12`;
