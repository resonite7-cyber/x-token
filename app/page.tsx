"use client";

import { useEffect, useState } from "react";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";

import SolanaWalletButton from "./components/SolanaWalletButton";

import { Keypair, PublicKey, Transaction } from "@solana/web3.js";

import { PUMP_SDK } from "@pump-fun/pump-sdk";

interface XUser {
  id: string;
  name: string;
  username: string;
  profile_image_url?: string;
}

export default function Home() {
  // =====================================================
  // X (TWITTER) AUTH
  // =====================================================

  const [xUser, setXUser] = useState<XUser | null>(null);

  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    fetch("/api/auth/x/me")
      .then((res) => (res.ok ? res.json() : { authenticated: false }))
      .then((data) => {
        setXUser(data.authenticated ? data.user : null);
      })
      .catch(() => {
        setXUser(null);
      })
      .finally(() => {
        setCheckingAuth(false);
      });
  }, []);

  const loginWithX = () => {
    window.location.href = "/api/auth/x";
  };

  const logoutFromX = async () => {
    await fetch("/api/auth/x/logout", { method: "POST" });

    setXUser(null);
  };

  // =====================================================
  // SOLANA
  // =====================================================

  const { publicKey, connected, signTransaction } = useWallet();

  const { connection } = useConnection();

  // =====================================================
  // FORM
  // =====================================================

  const [tokenName, setTokenName] = useState("");

  const [tokenSymbol, setTokenSymbol] = useState("");

  const [description, setDescription] = useState("");

  const [imageUrl, setImageUrl] = useState("");

  const [website, setWebsite] = useState("");

  const [twitter, setTwitter] = useState("");

  const [telegram, setTelegram] = useState("");

  // =====================================================
  // STATE
  // =====================================================

  const [launching, setLaunching] = useState(false);

  const [error, setError] = useState("");

  const [success, setSuccess] = useState(false);

  const [mintAddress, setMintAddress] = useState("");

  const [transactionSignature, setTransactionSignature] = useState("");

  // =====================================================
  // LAUNCH COIN
  // =====================================================

  const launchCoin = async () => {
    setError("");
    setSuccess(false);
    setMintAddress("");
    setTransactionSignature("");

    // -----------------------------------------------------
    // WALLET
    // -----------------------------------------------------

    if (!connected || !publicKey) {
      setError("Please connect your Solana wallet first.");

      return;
    }

    if (!signTransaction) {
      setError("Your wallet does not support transaction signing.");

      return;
    }

    // -----------------------------------------------------
    // VALIDATION
    // -----------------------------------------------------

    const name = tokenName.trim();

    const symbol = tokenSymbol.trim().toUpperCase();

    const descriptionText = description.trim();

    const image = imageUrl.trim();

    if (!name) {
      setError("Please enter a coin name.");

      return;
    }

    if (!symbol) {
      setError("Please enter a ticker.");

      return;
    }

    if (!descriptionText) {
      setError("Please enter a description.");

      return;
    }

    if (!image) {
      setError("Please enter an image URL.");

      return;
    }

    try {
      setLaunching(true);

      // ===================================================
      // 1. CREATE MINT KEYPAIR
      // ===================================================

      /*
       * This generates the new token mint.
       *
       * IMPORTANT:
       *
       * The secret key only exists in this
       * browser session.
       *
       * We do NOT send it to our server.
       */

      const mint = Keypair.generate();

      console.log("New mint:", mint.publicKey.toBase58());

      // ===================================================
      // 2. METADATA
      // ===================================================

      /*
       * Pump requires a metadata URI.
       *
       * For the first test we allow you
       * to provide a public metadata URL.
       *
       * Example:
       *
       * https://your-domain.com/metadata.json
       */

      const metadataUri = image;

      /*
       * IMPORTANT:
       *
       * imageUrl is being used as the URI
       * only for this first test.
       *
       * Later we'll create a real metadata
       * upload endpoint that produces:
       *
       * {
       *   name,
       *   symbol,
       *   description,
       *   image,
       *   website,
       *   twitter,
       *   telegram
       * }
       */

      console.log("Metadata URI:", metadataUri);

      // ===================================================
      // 3. CREATE PUMP INSTRUCTION
      // ===================================================

      const createInstruction = await PUMP_SDK.createV2Instruction({
        mint: mint.publicKey,

        name,

        symbol,

        uri: metadataUri,

        creator: publicKey,

        user: publicKey,

        mayhemMode: false,

        cashback: false,
      });

      // ===================================================
      // 4. GET BLOCKHASH
      // ===================================================

      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("confirmed");

      // ===================================================
      // 5. CREATE TRANSACTION
      // ===================================================

      const transaction = new Transaction();

      transaction.feePayer = publicKey;

      transaction.recentBlockhash = blockhash;

      transaction.lastValidBlockHeight = lastValidBlockHeight;

      transaction.add(createInstruction);

      // ===================================================
      // 6. MINT KEYPAIR SIGNS
      // ===================================================

      /*
       * Pump's create transaction requires
       * the mint keypair to sign.
       */

      transaction.partialSign(mint);

      // ===================================================
      // 7. USER WALLET SIGNS
      // ===================================================

      /*
       * This opens Phantom.
       *
       * User must approve the transaction.
       */

      const signedTransaction = await signTransaction(transaction);

      // ===================================================
      // 8. SEND TRANSACTION
      // ===================================================

      const signature = await connection.sendRawTransaction(
        signedTransaction.serialize(),
        {
          skipPreflight: false,
        },
      );

      console.log("Transaction submitted:", signature);

      setTransactionSignature(signature);

      // ===================================================
      // 9. WAIT FOR CONFIRMATION
      // ===================================================

      await connection.confirmTransaction(
        {
          signature,

          blockhash,

          lastValidBlockHeight,
        },
        "confirmed",
      );

      // ===================================================
      // 10. SUCCESS
      // ===================================================

      setMintAddress(mint.publicKey.toBase58());

      setSuccess(true);

      console.log("================================");

      console.log("PUMP COIN CREATED");

      console.log("Mint:", mint.publicKey.toBase58());

      console.log("Transaction:", signature);

      console.log("================================");
    } catch (err) {
      console.error("Pump launch error:", err);

      setError(err instanceof Error ? err.message : "Coin creation failed.");
    } finally {
      setLaunching(false);
    }
  };

  // =====================================================
  // PAGE
  // =====================================================

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-2xl px-6 py-12">
        {/* HEADER */}

        <div className="mb-10 text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-white text-2xl">
            🚀
          </div>

          <h1 className="text-4xl font-bold">Launch Your Coin</h1>

          <p className="mt-4 text-gray-400">Launch a coin on Pump.fun.</p>
        </div>

        {/* ================================================= */}
        {/* X LOGIN */}
        {/* ================================================= */}

        <div className="mb-6 rounded-2xl border border-gray-800 bg-gray-950 p-6">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-600">
            Step 1
          </p>

          <h2 className="mb-5 text-xl font-semibold">Login with X</h2>

          {checkingAuth ? (
            <p className="text-sm text-gray-500">Checking session...</p>
          ) : xUser ? (
            <div className="flex items-center justify-between rounded-xl border border-green-900 bg-green-950/20 p-4">
              <div className="flex items-center gap-3">
                {xUser.profile_image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={xUser.profile_image_url}
                    alt={xUser.username}
                    className="h-10 w-10 rounded-full"
                  />
                )}

                <div>
                  <p className="font-semibold text-green-400">
                    ✓ {xUser.name}
                  </p>

                  <p className="text-xs text-gray-500">@{xUser.username}</p>
                </div>
              </div>

              <button
                onClick={logoutFromX}
                className="rounded-lg border border-gray-700 px-3 py-2 text-xs text-gray-300 hover:bg-gray-900"
              >
                Logout
              </button>
            </div>
          ) : (
            <button
              onClick={loginWithX}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-white px-6 py-4 font-semibold text-black transition hover:bg-gray-200"
            >
              𝕏 Login with X
            </button>
          )}
        </div>

        {/* ================================================= */}
        {/* WALLET */}
        {/* ================================================= */}

        {xUser && (
          <div className="mb-6 rounded-2xl border border-gray-800 bg-gray-950 p-6">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-600">
              Step 2
            </p>

            <h2 className="mb-5 text-xl font-semibold">
              Connect Solana Wallet
            </h2>

            <SolanaWalletButton />

            {connected && publicKey && (
              <div className="mt-5 rounded-xl border border-green-900 bg-green-950/20 p-4">
                <p className="font-semibold text-green-400">
                  ✓ Wallet Connected
                </p>

                <p className="mt-2 break-all text-xs text-gray-500">
                  {publicKey.toBase58()}
                </p>
              </div>
            )}
          </div>
        )}

        {/* ================================================= */}
        {/* TOKEN FORM */}
        {/* ================================================= */}

        {xUser && connected && (
          <div className="rounded-2xl border border-gray-800 bg-gray-950 p-6">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-600">
              Step 3
            </p>

            <h2 className="mb-6 text-xl font-semibold">Coin Details</h2>

            {/* NAME */}

            <div className="mb-5">
              <label className="mb-2 block text-sm text-gray-300">
                Coin Name
              </label>

              <input
                value={tokenName}
                onChange={(e) => setTokenName(e.target.value)}
                placeholder="Gaurav Coin"
                className="w-full rounded-xl border border-gray-800 bg-black px-4 py-3 text-white outline-none placeholder:text-gray-600 focus:border-white"
              />
            </div>

            {/* SYMBOL */}

            <div className="mb-5">
              <label className="mb-2 block text-sm text-gray-300">Ticker</label>

              <input
                value={tokenSymbol}
                onChange={(e) => setTokenSymbol(e.target.value.toUpperCase())}
                maxLength={10}
                placeholder="GPC"
                className="w-full rounded-xl border border-gray-800 bg-black px-4 py-3 uppercase text-white outline-none placeholder:text-gray-600 focus:border-white"
              />
            </div>

            {/* DESCRIPTION */}

            <div className="mb-5">
              <label className="mb-2 block text-sm text-gray-300">
                Description
              </label>

              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                placeholder="Describe your coin..."
                className="w-full resize-none rounded-xl border border-gray-800 bg-black px-4 py-3 text-white outline-none placeholder:text-gray-600 focus:border-white"
              />
            </div>

            {/* METADATA URI */}

            <div className="mb-5">
              <label className="mb-2 block text-sm text-gray-300">
                Metadata JSON URL
              </label>

              <input
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://example.com/metadata.json"
                className="w-full rounded-xl border border-gray-800 bg-black px-4 py-3 text-white outline-none placeholder:text-gray-600 focus:border-white"
              />

              <p className="mt-2 text-xs text-gray-600">
                This must be a public JSON metadata URL.
              </p>
            </div>

            {/* WEBSITE */}

            <div className="mb-5">
              <label className="mb-2 block text-sm text-gray-300">
                Website
              </label>

              <input
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://example.com"
                className="w-full rounded-xl border border-gray-800 bg-black px-4 py-3 text-white outline-none placeholder:text-gray-600 focus:border-white"
              />
            </div>

            {/* X */}

            <div className="mb-5">
              <label className="mb-2 block text-sm text-gray-300">
                X / Twitter
              </label>

              <input
                value={twitter}
                onChange={(e) => setTwitter(e.target.value)}
                placeholder="https://x.com/..."
                className="w-full rounded-xl border border-gray-800 bg-black px-4 py-3 text-white outline-none placeholder:text-gray-600 focus:border-white"
              />
            </div>

            {/* TELEGRAM */}

            <div className="mb-6">
              <label className="mb-2 block text-sm text-gray-300">
                Telegram
              </label>

              <input
                value={telegram}
                onChange={(e) => setTelegram(e.target.value)}
                placeholder="https://t.me/..."
                className="w-full rounded-xl border border-gray-800 bg-black px-4 py-3 text-white outline-none placeholder:text-gray-600 focus:border-white"
              />
            </div>

            {/* ERROR */}

            {error && (
              <div className="mb-5 rounded-xl border border-red-900 bg-red-950/30 p-4 text-sm text-red-400">
                {error}
              </div>
            )}

            {/* SUCCESS */}

            {success && (
              <div className="mb-6 rounded-2xl border border-green-800 bg-green-950/20 p-6">
                <div className="text-center">
                  <div className="text-5xl">🎉</div>

                  <h2 className="mt-3 text-2xl font-bold text-green-400">
                    Coin Created Successfully!
                  </h2>

                  <p className="mt-2 text-sm text-gray-500">
                    Your Pump coin was created on Solana.
                  </p>
                </div>

                {/* MINT */}

                <div className="mt-6">
                  <p className="mb-2 text-sm text-gray-500">Mint Address</p>

                  <div className="rounded-xl bg-black p-4">
                    <p className="break-all text-xs text-gray-300">
                      {mintAddress}
                    </p>
                  </div>

                  <a
                    href={`https://solscan.io/token/${mintAddress}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 block text-center text-sm text-blue-400 hover:text-blue-300"
                  >
                    View Token on Solscan ↗
                  </a>
                </div>

                {/* TRANSACTION */}

                <div className="mt-6">
                  <p className="mb-2 text-sm text-gray-500">Transaction</p>

                  <div className="rounded-xl bg-black p-4">
                    <p className="break-all text-xs text-gray-300">
                      {transactionSignature}
                    </p>
                  </div>

                  <a
                    href={`https://solscan.io/tx/${transactionSignature}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 block text-center text-sm text-blue-400 hover:text-blue-300"
                  >
                    View Transaction on Solscan ↗
                  </a>
                </div>

                {/* PUMP */}

                <a
                  href={`https://pump.fun/coin/${mintAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-6 block w-full rounded-xl bg-white px-5 py-3 text-center font-semibold text-black hover:bg-gray-200"
                >
                  Open on Pump.fun ↗
                </a>
              </div>
            )}

            {/* LAUNCH */}

            {!success && (
              <button
                onClick={launchCoin}
                disabled={launching}
                className="w-full rounded-xl bg-white px-6 py-4 font-semibold text-black transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {launching ? "Preparing Transaction..." : "🚀 Launch Coin"}
              </button>
            )}
          </div>
        )}

        <p className="mt-8 text-center text-xs text-gray-700">
          Solana · Pump.fun
        </p>
      </div>
    </main>
  );
}
