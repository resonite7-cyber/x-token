/*
 * Copies the compiled Token.sol ABI and bytecode into a committed TypeScript
 * module the browser can import.
 *
 * artifacts/ is gitignored, so the app cannot import the Hardhat JSON directly
 * without breaking every build that has not run `hardhat compile` first.
 *
 * Run after changing contracts/Token.sol:  node scripts/sync-token-artifact.mjs
 */
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const artifact = require("../artifacts/contracts/Token.sol/Token.json");

const KEEP = ["approve", "balanceOf", "transfer", "allowance", "totalSupply", "decimals", "name", "symbol"];

const abi = artifact.abi.filter(
  (entry) => entry.type === "constructor" || (entry.type === "function" && KEEP.includes(entry.name)),
);

const out = `import type { Hex } from "viem";

/*
 * Compiled bytecode for contracts/Token.sol, inlined so the browser can deploy
 * it. Hardhat's artifacts/ directory is gitignored, so importing the JSON
 * directly would break any build that has not run \`hardhat compile\` first.
 *
 * Regenerate with: node scripts/sync-token-artifact.mjs
 */

export const TOKEN_ABI = ${JSON.stringify(abi, null, 2)} as const;

export const TOKEN_BYTECODE: Hex =
  "${artifact.bytecode}";
`;

writeFileSync(new URL("../app/src/lib/pons/tokenArtifact.ts", import.meta.url), out);

console.log(`wrote app/src/lib/pons/tokenArtifact.ts (${abi.length} ABI entries, ${artifact.bytecode.length} chars of bytecode)`);
