# Hardhat + viem project

## Project layout

```
contracts/        Solidity source files (*.sol) and unit tests (*.t.sol)
test/             TypeScript integration tests and Solidity unit tests (*.sol)
ignition/         Hardhat Ignition deployment modules
scripts/          Standalone scripts run with `hardhat run`
hardhat.config.ts
```

## Working in this project

When writing or modifying tests, configuring `hardhat.config.ts`, or interacting with the network from TypeScript, invoke the **`hardhat`** skill. It covers Solidity and TypeScript testing, how to choose between them, `forge-std` cheatcodes, the `network.create()` API, `networkHelpers`, and the compile-then-typecheck workflow. The skill itself points to the matching `hardhat-toolbox-*` skill for toolbox-specific guidance (clients, contract interaction, assertions).

## Docs

- Hardhat 3 — https://hardhat.org/llms.txt
- viem — https://viem.sh/llms.txt

# Project Rules

## File Reading
- Grep/search for the relevant selector, function, class, or ID before reading a file.
- Read only the needed line range, not the whole file.
- Don't re-read a file already read this session unless it changed.
- Check for duplicate/conflicting definitions of the same selector or function before editing.

## Output Format
- Never paste back a full file after editing. Show only the changed lines: before → after.
- No restating the request. No unrelated explanation. Fix, then stop.
- Don't re-list unchanged code.
- No theory, background, or "why this generally happens" explanations during coding chat — just the fix.
- No preamble like "I understand" or "let me explain" — go straight to the diagnosis/fix.

## Editing Behavior
- Surgical edits only — don't touch unrelated code unless asked.
- If a bug is caused by duplicate/dead/conflicting code, say which one to delete instead of adding another override on top.
- Use one shared source of truth (variable/constant) instead of repeating the same value in multiple places.

## Structure
- Main file(s): [fill in]
- Key components: [fill in]

## Known Trouble Spots
- [fill in as they come up]

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
