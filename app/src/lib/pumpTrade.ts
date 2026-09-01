import {
  getBuyTokenAmountFromSolAmount,
  getPumpProgram,
  getSellSolAmountFromTokenAmount,
  OnlinePumpSdk,
  PUMP_PROGRAM_ID,
  PUMP_SDK,
} from "@pump-fun/pump-sdk";

import {
  getAssociatedTokenAddressSync,
  getMint,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

import BN from "bn.js";

/*
 * Coins in this app are created via createV2Instruction, which mints on
 * Token-2022. Trading must use the same token program the mint actually
 * lives on, or every instruction will fail account validation.
 */
const MINT_TOKEN_PROGRAM = TOKEN_2022_PROGRAM_ID;
const QUOTE_TOKEN_PROGRAM = TOKEN_PROGRAM_ID;

const DEFAULT_SLIPPAGE_PERCENT = 1;

export interface MintTradeState {
  /** True once the bonding curve has migrated to the Pump AMM. Trading via this module is not supported after that. */
  graduated: boolean;
  /** Current token price in SOL, derived from the bonding curve's virtual reserves. */
  priceSol: number;
  /** Real SOL raised so far on the curve. */
  realQuoteReservesSol: number;
  /** Real tokens remaining to be sold before migration. */
  realTokenReserves: string;
  userTokenBalance: string;
}

async function loadFeeInputs(
  onlineSdk: OnlinePumpSdk,
  connection: Connection,
  mint: PublicKey,
) {
  const [feeConfig, mintInfo] = await Promise.all([
    onlineSdk.fetchFeeConfig().catch(() => null),
    getMint(connection, mint, "confirmed", MINT_TOKEN_PROGRAM),
  ]);

  return {
    feeConfig,
    mintSupply: new BN(mintInfo.supply.toString()),
  };
}

export async function getMintTradeState({
  connection,
  mint,
  user,
}: {
  connection: Connection;
  mint: PublicKey;
  user: PublicKey;
}): Promise<MintTradeState> {
  const onlineSdk = new OnlinePumpSdk(connection);

  const { bondingCurveAccountInfo, associatedUserAccountInfo } =
    await onlineSdk.fetchBuyState(mint, user, MINT_TOKEN_PROGRAM);

  const bondingCurve = PUMP_SDK.decodeBondingCurve(bondingCurveAccountInfo);

  const userTokenBalance = associatedUserAccountInfo
    ? await connection
        .getTokenAccountBalance(
          getAssociatedTokenAddressSync(mint, user, true, MINT_TOKEN_PROGRAM),
        )
        .then((res) => res.value.amount)
        .catch(() => "0")
    : "0";

  const priceSol =
    bondingCurve.virtualTokenReserves.isZero()
      ? 0
      : bondingCurve.virtualQuoteReserves.toNumber() /
        1e9 /
        (bondingCurve.virtualTokenReserves.toNumber() / 1e6);

  return {
    graduated: bondingCurve.complete,
    priceSol,
    realQuoteReservesSol: bondingCurve.realQuoteReserves.toNumber() / 1e9,
    realTokenReserves: bondingCurve.realTokenReserves.toString(),
    userTokenBalance,
  };
}

export interface MintPrice {
  graduated: boolean;
  priceSol: number;
}

/** Wallet-free price lookup for display purposes (e.g. a public trade grid). */
export async function getMintPrice(
  connection: Connection,
  mint: PublicKey,
): Promise<MintPrice> {
  const onlineSdk = new OnlinePumpSdk(connection);

  const bondingCurve = await onlineSdk.fetchBondingCurve(mint);

  const priceSol = bondingCurve.virtualTokenReserves.isZero()
    ? 0
    : bondingCurve.virtualQuoteReserves.toNumber() /
      1e9 /
      (bondingCurve.virtualTokenReserves.toNumber() / 1e6);

  return {
    graduated: bondingCurve.complete,
    priceSol,
  };
}

export async function buildBuyInstructions({
  connection,
  mint,
  user,
  solAmountLamports,
  slippagePercent = DEFAULT_SLIPPAGE_PERCENT,
}: {
  connection: Connection;
  mint: PublicKey;
  user: PublicKey;
  solAmountLamports: BN;
  slippagePercent?: number;
}): Promise<TransactionInstruction[]> {
  const onlineSdk = new OnlinePumpSdk(connection);

  const [global, { bondingCurveAccountInfo, bondingCurve, associatedUserAccountInfo }] =
    await Promise.all([
      onlineSdk.fetchGlobal(),
      onlineSdk.fetchBuyState(mint, user, MINT_TOKEN_PROGRAM),
    ]);

  if (bondingCurve.complete) {
    throw new Error(
      "This coin has migrated to the Pump AMM and can no longer be traded on the bonding curve.",
    );
  }

  const { feeConfig, mintSupply } = await loadFeeInputs(
    onlineSdk,
    connection,
    mint,
  );

  const tokenAmount = getBuyTokenAmountFromSolAmount({
    global,
    feeConfig,
    mintSupply,
    bondingCurve,
    amount: solAmountLamports,
    quoteMint: bondingCurve.quoteMint,
  });

  if (tokenAmount.isZero()) {
    throw new Error("SOL amount is too small to buy any tokens.");
  }

  return PUMP_SDK.buyV2Instructions({
    global,
    bondingCurveAccountInfo,
    bondingCurve,
    associatedUserAccountInfo,
    mint,
    user,
    amount: tokenAmount,
    quoteAmount: solAmountLamports,
    slippage: slippagePercent,
    tokenProgram: MINT_TOKEN_PROGRAM,
    quoteTokenProgram: QUOTE_TOKEN_PROGRAM,
  });
}

export async function buildSellInstructions({
  connection,
  mint,
  user,
  tokenAmount,
  slippagePercent = DEFAULT_SLIPPAGE_PERCENT,
}: {
  connection: Connection;
  mint: PublicKey;
  user: PublicKey;
  tokenAmount: BN;
  slippagePercent?: number;
}): Promise<TransactionInstruction[]> {
  const onlineSdk = new OnlinePumpSdk(connection);

  const [global, { bondingCurveAccountInfo, bondingCurve }] = await Promise.all([
    onlineSdk.fetchGlobal(),
    onlineSdk.fetchSellState(mint, user, MINT_TOKEN_PROGRAM),
  ]);

  if (bondingCurve.complete) {
    throw new Error(
      "This coin has migrated to the Pump AMM and can no longer be traded on the bonding curve.",
    );
  }

  const { feeConfig, mintSupply } = await loadFeeInputs(
    onlineSdk,
    connection,
    mint,
  );

  const solAmount = getSellSolAmountFromTokenAmount({
    global,
    feeConfig,
    mintSupply,
    bondingCurve,
    amount: tokenAmount,
  });

  if (solAmount.isZero()) {
    throw new Error("Token amount is too small to sell for any SOL.");
  }

  return PUMP_SDK.sellV2Instructions({
    global,
    bondingCurveAccountInfo,
    bondingCurve,
    mint,
    user,
    amount: tokenAmount,
    quoteAmount: solAmount,
    slippage: slippagePercent,
    tokenProgram: MINT_TOKEN_PROGRAM,
    quoteTokenProgram: QUOTE_TOKEN_PROGRAM,
  });
}

/**
 * Attaches a freshly-fetched blockhash to instructions. Callers should invoke
 * this immediately before requesting a wallet signature, not earlier in the
 * flow — a blockhash is only valid for ~60-90s, and slow SDK/network calls or
 * wallet-popup latency can otherwise cause `Blockhash not found` at send time.
 */
export async function finalizeTransaction({
  connection,
  user,
  instructions,
}: {
  connection: Connection;
  user: PublicKey;
  instructions: TransactionInstruction[];
}): Promise<Transaction> {
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");

  const transaction = new Transaction();
  transaction.feePayer = user;
  transaction.recentBlockhash = blockhash;
  transaction.lastValidBlockHeight = lastValidBlockHeight;
  transaction.add(...instructions);

  return transaction;
}

export function solToLamports(sol: number): BN {
  return new BN(Math.round(sol * 1e9));
}

export function lamportsToSol(lamports: BN): number {
  return lamports.toNumber() / 1e9;
}

export interface TradeHistoryEntry {
  signature: string;
  slot: number;
  blockTime: number | null;
  mint: string;
  isBuy: boolean;
  solAmount: number;
  tokenAmount: string;
}

/**
 * Reconstructs a wallet's buy/sell history by decoding the Pump program's
 * `TradeEvent` from each of its recent transactions' logs. There is no
 * indexer here, so this only sees as far back as `limit` signatures.
 */
export async function getWalletTradeHistory({
  connection,
  user,
  limit = 50,
}: {
  connection: Connection;
  user: PublicKey;
  limit?: number;
}): Promise<TradeHistoryEntry[]> {
  const program = getPumpProgram(connection);

  const signatures = (
    await connection.getSignaturesForAddress(user, { limit })
  ).filter((sigInfo) => !sigInfo.err);

  const entries: TradeHistoryEntry[] = [];

  const FETCH_CONCURRENCY = 8;

  for (let i = 0; i < signatures.length; i += FETCH_CONCURRENCY) {
    const batch = signatures.slice(i, i + FETCH_CONCURRENCY);

    const txs = await Promise.all(
      batch.map((sigInfo) =>
        connection.getTransaction(sigInfo.signature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        }),
      ),
    );

    for (let j = 0; j < batch.length; j++) {
      const sigInfo = batch[j];
      const tx = txs[j];
      const logs = tx?.meta?.logMessages;

      if (!tx || !logs) {
        continue;
      }

      const touchesPump = tx.transaction.message
        .getAccountKeys()
        .staticAccountKeys.some((key) => key.equals(PUMP_PROGRAM_ID));

      if (!touchesPump) {
        continue;
      }

      for (const log of logs) {
        const prefix = "Program data: ";

        if (!log.startsWith(prefix)) {
          continue;
        }

        let decoded;

        try {
          decoded = program.coder.events.decode(log.slice(prefix.length));
        } catch {
          continue;
        }

        if (!decoded || decoded.name !== "tradeEvent") {
          continue;
        }

        const data = decoded.data as {
          mint: PublicKey;
          solAmount: BN;
          tokenAmount: BN;
          isBuy: boolean;
          user: PublicKey;
        };

        if (!data.user.equals(user)) {
          continue;
        }

        entries.push({
          signature: sigInfo.signature,
          slot: sigInfo.slot,
          blockTime: sigInfo.blockTime ?? null,
          mint: data.mint.toBase58(),
          isBuy: data.isBuy,
          solAmount: data.solAmount.toNumber() / 1e9,
          tokenAmount: data.tokenAmount.toString(),
        });
      }
    }
  }

  return entries;
}
