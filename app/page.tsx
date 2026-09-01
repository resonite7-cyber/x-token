"use client";

import { useEffect, useRef, useState } from "react";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";

import { Keypair, Transaction } from "@solana/web3.js";

import { PUMP_SDK } from "@pump-fun/pump-sdk";

import {
  Lock,
  Check,
  Wallet,
  Rocket,
  ExternalLink,
  HelpCircle,
  X,
  ImagePlus,
  Loader2,
  Globe,
  Send,
} from "lucide-react";

import SolanaWalletButton from "./components/SolanaWalletButton";

interface XUser {
  id: string;
  name: string;
  username: string;
  profile_image_url?: string;
}

const SOLANA_RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

// Solscan defaults to mainnet, so non-mainnet links need an explicit cluster.
const SOLSCAN_CLUSTER_PARAM = SOLANA_RPC_URL.includes("devnet")
  ? "?cluster=devnet"
  : SOLANA_RPC_URL.includes("testnet")
    ? "?cluster=testnet"
    : "";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

type WizardStep = 1 | 2 | 3 | 4;

export default function Home() {
  // =====================================================
  // X (TWITTER) AUTH
  // =====================================================

  const [xUser, setXUser] = useState<XUser | null>(null);

  const [checkingAuth, setCheckingAuth] = useState(true);

  // =====================================================
  // FORM
  // =====================================================

  const [coinName, setCoinName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [twitter, setTwitter] = useState("");
  const [telegram, setTelegram] = useState("");

  // Image the user picks locally. Uploaded to storage automatically at
  // launch time — the user never sees or enters a metadata/IPFS URL.
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState("");
  const [imageError, setImageError] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/auth/x/me")
      .then((res) => (res.ok ? res.json() : { authenticated: false }))
      .then((data) => {
        const user = data.authenticated ? data.user : null;

        setXUser(user);

        if (user) {
          setTwitter(`https://x.com/${user.username}`);
        }
      })
      .catch(() => {
        setXUser(null);
      })
      .finally(() => {
        setCheckingAuth(false);
      });
  }, []);

  useEffect(() => {
    if (!imageFile) {
      return;
    }

    const url = URL.createObjectURL(imageFile);

    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing preview URL to the external object-URL lifecycle tied to this effect
    setImagePreviewUrl(url);

    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  const loginWithX = () => {
    window.location.href = "/api/auth/x";
  };

  const logoutFromX = async () => {
    await fetch("/api/auth/x/logout", { method: "POST" });

    setXUser(null);
  };

  const handleImageSelect = (file: File | null) => {
    setImageError("");

    if (!file) {
      setImageFile(null);
      setImagePreviewUrl("");

      return;
    }

    if (!file.type.startsWith("image/")) {
      setImageError("Please choose an image file (PNG, JPG, GIF, or WEBP).");

      return;
    }

    if (file.size > MAX_IMAGE_BYTES) {
      setImageError("Image must be 5MB or smaller.");

      return;
    }

    setImageFile(file);
  };

  // =====================================================
  // SOLANA
  // =====================================================

  const { publicKey, connected, signTransaction } = useWallet();

  const { connection } = useConnection();

  const walletAddress = publicKey?.toBase58() ?? "";

  const walletShort = walletAddress
    ? `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`
    : "";

  // =====================================================
  // LAUNCH STATE
  // =====================================================

  const [launching, setLaunching] = useState(false);
  const [launchStage, setLaunchStage] = useState("");

  const [error, setError] = useState("");

  const [success, setSuccess] = useState(false);

  const [mintAddress, setMintAddress] = useState("");

  const [transactionSignature, setTransactionSignature] = useState("");

  // =====================================================
  // STEP GATING
  // =====================================================

  const xConnected = Boolean(xUser);
  const walletConnected = xConnected && connected;

  const coinDetailsValid =
    coinName.trim() !== "" &&
    symbol.trim() !== "" &&
    description.trim() !== "" &&
    Boolean(imageFile);

  const coinDetailsEnabled = walletConnected;
  const reviewEnabled = coinDetailsEnabled && coinDetailsValid;

  const launchEnabled = reviewEnabled && !launching;

  // Drives which panel is shown on the right. Advances automatically as
  // earlier steps complete, but the user can still click back to an
  // earlier unlocked step.
  const [activeStep, setActiveStep] = useState<WizardStep>(1);

  useEffect(() => {
    if (!xConnected) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- advancing the wizard in response to the external X session check completing
      setActiveStep(1);

      return;
    }

    if (!walletConnected) {
      setActiveStep(2);

      return;
    }

    setActiveStep((current) => (current === 1 || current === 2 ? 3 : current));
  }, [xConnected, walletConnected]);

  const goToStep = (step: WizardStep) => {
    if (step === 1) setActiveStep(1);
    else if (step === 2 && xConnected) setActiveStep(2);
    else if (step === 3 && coinDetailsEnabled) setActiveStep(3);
    else if (step === 4 && reviewEnabled) setActiveStep(4);
  };

  const goToReview = () => {
    if (reviewEnabled) setActiveStep(4);
  };

  // =====================================================
  // LAUNCH COIN
  // =====================================================

  const launchCoin = async () => {
    setError("");
    setSuccess(false);
    setMintAddress("");
    setTransactionSignature("");

    if (!connected || !publicKey) {
      setError("Please connect your Solana wallet first.");

      return;
    }

    if (!signTransaction) {
      setError("Your wallet does not support transaction signing.");

      return;
    }

    const name = coinName.trim();

    const tokenSymbol = symbol.trim().toUpperCase();

    const descriptionText = description.trim();

    if (!name || !tokenSymbol || !descriptionText || !imageFile) {
      setError("Please fill in all required fields.");

      return;
    }

    try {
      setLaunching(true);

      // -----------------------------------------------------
      // 1. Generate metadata JSON + upload image automatically.
      //    The user never sees or provides a metadata/IPFS URL.
      // -----------------------------------------------------
      setLaunchStage("Uploading image and creating metadata...");

      const metadataForm = new FormData();

      metadataForm.set("image", imageFile);
      metadataForm.set("name", name);
      metadataForm.set("symbol", tokenSymbol);
      metadataForm.set("description", descriptionText);

      if (website.trim()) metadataForm.set("website", website.trim());
      if (twitter.trim()) metadataForm.set("twitter", twitter.trim());
      if (telegram.trim()) metadataForm.set("telegram", telegram.trim());

      const metadataRes = await fetch("/api/metadata", {
        method: "POST",
        body: metadataForm,
      });

      const metadataData = await metadataRes.json();

      if (!metadataRes.ok || !metadataData.success || !metadataData.metadataUri) {
        throw new Error(
          metadataData.message || "Failed to prepare token metadata.",
        );
      }

      const metadataUri: string = metadataData.metadataUri;
      const uploadedImageUri: string = metadataData.imageUri || "";

      // -----------------------------------------------------
      // 2. Build and send the Pump.fun create transaction using the
      //    metadata URI produced above.
      // -----------------------------------------------------
      setLaunchStage("Preparing transaction...");

      // Generates the new token mint. The secret key only exists in this
      // browser session and is never sent to our server.
      const mint = Keypair.generate();

      console.log("New mint:", mint.publicKey.toBase58());

      const createInstruction = await PUMP_SDK.createV2Instruction({
        mint: mint.publicKey,
        name,
        symbol: tokenSymbol,
        uri: metadataUri,
        creator: publicKey,
        user: publicKey,
        mayhemMode: false,
        cashback: false,
      });

      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("confirmed");

      const transaction = new Transaction();

      transaction.feePayer = publicKey;

      transaction.recentBlockhash = blockhash;

      transaction.lastValidBlockHeight = lastValidBlockHeight;

      transaction.add(createInstruction);

      // Pump's create transaction requires the mint keypair to co-sign.
      transaction.partialSign(mint);

      setLaunchStage("Waiting for wallet signature...");

      const signedTransaction = await signTransaction(transaction);

      setLaunchStage("Submitting transaction...");

      const signature = await connection.sendRawTransaction(
        signedTransaction.serialize(),
        {
          skipPreflight: false,
        },
      );

      console.log("Transaction submitted:", signature);

      setTransactionSignature(signature);

      setLaunchStage("Confirming transaction...");

      await connection.confirmTransaction(
        {
          signature,
          blockhash,
          lastValidBlockHeight,
        },
        "confirmed",
      );

      setMintAddress(mint.publicKey.toBase58());

      setSuccess(true);

      // Best-effort registry entry so the coin shows up on /trade.
      // Preserved exactly as before — only the image source changed from
      // a user-typed URL to the URL returned by the metadata upload.
      fetch("/api/coins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          symbol: tokenSymbol,
          mint: mint.publicKey.toBase58(),
          creatorWallet: publicKey.toBase58(),
          image: uploadedImageUri || imagePreviewUrl,
        }),
      }).catch(() => {});

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
      setLaunchStage("");
    }
  };

  return (
    <main className="min-h-screen bg-[#05070b] text-white">
      <div className="mx-auto max-w-[1240px] px-4 py-8 sm:px-6 sm:py-10">
        {/* TITLE */}
        <div className="mb-8 flex items-center justify-center gap-5">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.02] text-3xl sm:h-20 sm:w-20 sm:text-4xl">
            🚀
          </div>

          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-4xl">
              Launch Your Coin
            </h1>

            <p className="mt-1 text-xs text-zinc-400 sm:text-sm">
              No crypto experience needed — we&apos;ll walk you through it.
            </p>
          </div>
        </div>

        {/* MAIN GRID */}
        <div className="grid gap-6 lg:grid-cols-[330px_minmax(0,1fr)]">
          {/* LEFT SIDEBAR — STEPPER */}
          <aside className="space-y-4">
            <StepNavItem
              step={1}
              label="STEP 1"
              title="Connect with X"
              description="Login with your X (Twitter) account"
              icon={<X size={21} />}
              state={xConnected ? "completed" : "active"}
              isActive={activeStep === 1}
              onClick={() => goToStep(1)}
            />

            <StepNavItem
              step={2}
              label="STEP 2"
              title="Connect Solana Wallet"
              description="Connect your Solana wallet"
              icon={<Wallet size={20} />}
              state={
                walletConnected
                  ? "completed"
                  : xConnected
                    ? "active"
                    : "locked"
              }
              isActive={activeStep === 2}
              onClick={() => goToStep(2)}
              lockedHint="Connect with X first"
            />

            <StepNavItem
              step={3}
              label="STEP 3"
              title="Create Your Coin"
              description="Name, image, and story for your coin"
              icon={<Rocket size={20} />}
              state={
                coinDetailsEnabled && coinDetailsValid
                  ? "completed"
                  : coinDetailsEnabled
                    ? "active"
                    : "locked"
              }
              isActive={activeStep === 3}
              onClick={() => goToStep(3)}
              lockedHint="Connect your wallet first"
            />

            <StepNavItem
              step={4}
              label="STEP 4"
              title="Review & Launch"
              description="Confirm details and go live"
              icon={<Check size={20} />}
              state={success ? "completed" : reviewEnabled ? "active" : "locked"}
              isActive={activeStep === 4}
              onClick={() => goToStep(4)}
              lockedHint="Finish your coin details first"
            />

            {/* HELP */}
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-600/20 text-violet-400">
                  <HelpCircle size={15} />
                </div>

                <h3 className="text-sm font-semibold">
                  Need help?
                </h3>
              </div>

              <p className="mt-3 text-xs leading-5 text-zinc-500">
                Complete each step in order. You can&apos;t change
                important token details after launch.
              </p>

              <a
                href="https://pump.fun"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-violet-400 hover:text-violet-300"
              >
                Learn more about Pump.fun
                <ExternalLink size={11} />
              </a>
            </div>
          </aside>

          {/* RIGHT CONTENT */}
          <section className="space-y-4">
            {/* STEP 1 PANEL */}
            {activeStep === 1 && (
              <PanelCard
                title="Connect with X"
                subtitle="We use your X (Twitter) account to verify you before you can create a coin."
              >
                {checkingAuth ? (
                  <div className="flex items-center gap-2 text-sm text-zinc-500">
                    <Loader2 size={16} className="animate-spin" />
                    Checking session...
                  </div>
                ) : !xUser ? (
                  <button
                    onClick={loginWithX}
                    className="flex h-12 w-full max-w-sm items-center justify-center gap-2 rounded-lg border border-white/20 bg-black px-4 text-sm font-semibold text-white transition hover:bg-white/[0.05]"
                  >
                    <X size={16} />
                    Connect with X
                  </button>
                ) : (
                  <div className="max-w-sm rounded-lg border border-green-500/30 bg-green-500/[0.06] px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm font-medium text-green-400">
                        <Check size={15} />@{xUser.username}
                      </div>

                      <button
                        onClick={logoutFromX}
                        className="text-xs font-medium text-zinc-500 hover:text-white"
                      >
                        Logout
                      </button>
                    </div>

                    <p className="mt-1.5 text-xs text-zinc-500">
                      Your X account is connected. Continue to the next
                      step.
                    </p>
                  </div>
                )}

                {xUser && (
                  <NextStepButton onClick={() => setActiveStep(2)}>
                    Continue to Wallet
                  </NextStepButton>
                )}
              </PanelCard>
            )}

            {/* STEP 2 PANEL */}
            {activeStep === 2 && (
              <PanelCard
                title="Connect Solana Wallet"
                subtitle="Connect the Solana wallet that will own and pay for your new coin."
                locked={!xConnected}
                lockedMessage="Connect with X to unlock this step."
              >
                {!connected ? (
                  <div className="max-w-sm">
                    <SolanaWalletButton />
                  </div>
                ) : (
                  <div className="max-w-sm rounded-lg border border-green-500/30 bg-green-500/[0.06] px-4 py-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-green-400">
                      <Check size={15} />
                      Wallet Connected
                    </div>

                    <p className="mt-1.5 text-xs text-zinc-500">
                      {walletShort}
                    </p>
                  </div>
                )}

                {connected && (
                  <NextStepButton onClick={() => setActiveStep(3)}>
                    Continue to Create Your Coin
                  </NextStepButton>
                )}
              </PanelCard>
            )}

            {/* STEP 3 PANEL — CREATE YOUR COIN */}
            {activeStep === 3 && (
              <PanelCard
                title="Create Your Coin"
                subtitle="Fill in the basics. We'll automatically prepare everything needed on-chain — no technical setup required."
                locked={!coinDetailsEnabled}
                lockedMessage="Connect your wallet to unlock this step."
              >
                <div className="grid gap-5 md:grid-cols-2">
                  {/* IMAGE UPLOAD */}
                  <div className="md:col-span-2">
                    <span className="mb-2 block text-xs font-semibold text-zinc-300">
                      Token Image
                    </span>

                    <div className="flex items-center gap-4">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-white/20 bg-black/40 text-zinc-500 transition hover:border-violet-500/60 hover:text-violet-400"
                      >
                        {imagePreviewUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- local object URL preview, not an optimizable remote asset
                          <img
                            src={imagePreviewUrl}
                            alt="Token preview"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <ImagePlus size={26} />
                        )}
                      </button>

                      <div className="flex-1">
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/png,image/jpeg,image/gif,image/webp"
                          className="hidden"
                          onChange={(e) =>
                            handleImageSelect(e.target.files?.[0] ?? null)
                          }
                        />

                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="rounded-lg border border-white/[0.15] bg-white/[0.03] px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/[0.08]"
                        >
                          {imageFile ? "Change image" : "Upload image"}
                        </button>

                        <p className="mt-2 text-[11px] leading-4 text-zinc-500">
                          PNG, JPG, GIF or WEBP. Max 5MB.
                        </p>

                        {imageError && (
                          <p className="mt-1 text-[11px] text-red-400">
                            {imageError}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* NAME */}
                  <Input
                    label="Token Name"
                    placeholder="Enter token name"
                    value={coinName}
                    onChange={setCoinName}
                    maxLength={32}
                    counter
                  />

                  {/* SYMBOL */}
                  <Input
                    label="Symbol"
                    placeholder="Enter symbol (e.g. BTC)"
                    value={symbol}
                    onChange={(v) => setSymbol(v.toUpperCase())}
                    maxLength={10}
                    counter
                  />

                  {/* DESCRIPTION */}
                  <div className="md:col-span-2">
                    <Textarea
                      label="Description"
                      placeholder="Describe your token..."
                      value={description}
                      onChange={setDescription}
                      maxLength={200}
                    />
                  </div>

                  {/* WEBSITE */}
                  <Input
                    label="Website"
                    placeholder="https://your-website.com"
                    value={website}
                    onChange={setWebsite}
                    optional
                    icon={<Globe size={14} />}
                  />

                  {/* TWITTER */}
                  <Input
                    label="X / Twitter"
                    placeholder="https://x.com/your-handle"
                    value={twitter}
                    onChange={setTwitter}
                    optional
                    icon={<X size={13} />}
                  />

                  {/* TELEGRAM */}
                  <Input
                    label="Telegram"
                    placeholder="https://t.me/your-channel"
                    value={telegram}
                    onChange={setTelegram}
                    optional
                    icon={<Send size={13} />}
                  />
                </div>

                {coinDetailsEnabled && (
                  <NextStepButton
                    onClick={goToReview}
                    disabled={!coinDetailsValid}
                  >
                    Continue to Review &amp; Launch
                  </NextStepButton>
                )}
              </PanelCard>
            )}

            {/* STEP 4 PANEL — REVIEW & LAUNCH */}
            {activeStep === 4 && (
              <PanelCard
                title="Review & Launch"
                subtitle="Double-check everything below, then launch your coin on Pump.fun."
                locked={!reviewEnabled}
                lockedMessage="Finish Step 3 to unlock this step."
              >
                {!success ? (
                  <>
                    <div className="flex flex-col gap-5 sm:flex-row">
                      <div className="h-28 w-28 shrink-0 overflow-hidden rounded-xl border border-white/[0.1] bg-black/40">
                        {imagePreviewUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- local object URL preview, not an optimizable remote asset
                          <img
                            src={imagePreviewUrl}
                            alt={coinName || "Token image"}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-zinc-700">
                            <ImagePlus size={26} />
                          </div>
                        )}
                      </div>

                      <div className="min-w-0 flex-1 space-y-3">
                        <div>
                          <p className="text-lg font-bold text-white">
                            {coinName || "Untitled Coin"}{" "}
                            <span className="text-sm font-medium text-zinc-500">
                              ${symbol || "SYMBOL"}
                            </span>
                          </p>

                          <p className="mt-1 text-sm leading-5 text-zinc-400">
                            {description}
                          </p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          {website && <SocialPill icon={<Globe size={12} />} label="Website" />}
                          {twitter && <SocialPill icon={<X size={11} />} label="X / Twitter" />}
                          {telegram && <SocialPill icon={<Send size={11} />} label="Telegram" />}
                        </div>
                      </div>
                    </div>

                    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/[0.08] bg-black/30 px-4 py-3">
                      <div className="flex items-center gap-2 text-sm text-zinc-300">
                        <span className="font-medium">Metadata</span>
                      </div>

                      <span className="rounded-md border border-green-500/30 bg-green-500/10 px-3 py-1 text-xs font-medium text-green-400">
                        Ready
                      </span>
                    </div>

                    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/[0.08] bg-black/30 px-4 py-3">
                      <div className="text-sm text-zinc-300">
                        <span className="font-medium">Creator</span>
                        <span className="ml-2 text-zinc-500">
                          @{xUser?.username}
                        </span>
                      </div>

                      <div className="text-sm text-zinc-300">
                        <span className="font-medium">Wallet</span>
                        <span className="ml-2 text-zinc-500">
                          {walletShort}
                        </span>
                      </div>
                    </div>

                    {launching && launchStage && (
                      <div className="mt-6 flex items-center gap-2 rounded-lg border border-violet-500/30 bg-violet-500/[0.06] px-4 py-3 text-sm text-violet-300">
                        <Loader2 size={16} className="animate-spin" />
                        {launchStage}
                      </div>
                    )}

                    {error && (
                      <div className="mt-6 rounded-lg border border-red-900 bg-red-950/30 p-4 text-sm text-red-400">
                        {error}
                      </div>
                    )}

                    <div className="mt-6">
                      <button
                        onClick={launchCoin}
                        disabled={!launchEnabled}
                        className={`
                          flex h-12 w-full items-center justify-center
                          gap-2 rounded-lg text-sm font-bold transition
                          ${
                            launchEnabled
                              ? "bg-gradient-to-r from-violet-600 via-indigo-500 to-green-500 text-white shadow-lg shadow-violet-900/20 hover:opacity-90"
                              : "cursor-not-allowed bg-zinc-800 text-zinc-600"
                          }
                        `}
                      >
                        {launching ? (
                          <>
                            <Loader2 size={16} className="animate-spin" />
                            {launchStage || "Launching..."}
                          </>
                        ) : !reviewEnabled ? (
                          <>
                            <Lock size={16} />
                            Complete Previous Steps
                          </>
                        ) : (
                          <>🚀 Launch Coin</>
                        )}
                      </button>
                    </div>
                  </>
                ) : (
                  <div>
                    <div className="text-center">
                      <div className="text-5xl">🎉</div>

                      <h3 className="mt-3 text-xl font-bold text-green-400">
                        Coin Created Successfully!
                      </h3>

                      <p className="mt-2 text-sm text-zinc-500">
                        Your Pump coin was created on Solana.
                      </p>
                    </div>

                    <div className="mt-6">
                      <p className="mb-2 text-sm text-zinc-500">
                        Mint Address
                      </p>

                      <div className="rounded-lg bg-black p-4">
                        <p className="break-all text-xs text-zinc-300">
                          {mintAddress}
                        </p>
                      </div>

                      <a
                        href={`https://solscan.io/token/${mintAddress}${SOLSCAN_CLUSTER_PARAM}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 block text-center text-sm text-violet-400 hover:text-violet-300"
                      >
                        View Token on Solscan ↗
                      </a>
                    </div>

                    <div className="mt-6">
                      <p className="mb-2 text-sm text-zinc-500">
                        Transaction
                      </p>

                      <div className="rounded-lg bg-black p-4">
                        <p className="break-all text-xs text-zinc-300">
                          {transactionSignature}
                        </p>
                      </div>

                      <a
                        href={`https://solscan.io/tx/${transactionSignature}${SOLSCAN_CLUSTER_PARAM}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 block text-center text-sm text-violet-400 hover:text-violet-300"
                      >
                        View Transaction on Solscan ↗
                      </a>
                    </div>

                    <a
                      href={`/trade/${mintAddress}`}
                      className="mt-6 block w-full rounded-lg bg-white px-5 py-3 text-center font-semibold text-black hover:bg-gray-200"
                    >
                      Trade This Coin →
                    </a>

                    <a
                      href={`https://pump.fun/coin/${mintAddress}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 block w-full rounded-lg border border-gray-700 px-5 py-3 text-center font-semibold text-gray-200 hover:bg-gray-900"
                    >
                      Open on Pump.fun ↗
                    </a>

                    {SOLSCAN_CLUSTER_PARAM && (
                      <p className="mt-3 text-center text-xs text-zinc-600">
                        Buying/selling on Pump.fun only works for coins
                        created on Solana mainnet. This coin was created on{" "}
                        {SOLSCAN_CLUSTER_PARAM.replace("?cluster=", "")}, so
                        the Pump.fun link above won&apos;t show a live market
                        yet.
                      </p>
                    )}
                  </div>
                )}
              </PanelCard>
            )}
          </section>
        </div>

        {/* FOOTER */}
        <footer className="py-8 text-center text-xs text-zinc-600">
          Built with <span className="text-red-500">♥</span> on{" "}
          <span className="text-violet-400">Solana</span>
        </footer>
      </div>
    </main>
  );
}

/* =========================================================
   PANEL CARD (right side content)
========================================================= */

type PanelCardProps = {
  title: string;
  subtitle: string;
  locked?: boolean;
  lockedMessage?: string;
  children: React.ReactNode;
};

function PanelCard({
  title,
  subtitle,
  locked,
  lockedMessage,
  children,
}: PanelCardProps) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#090c12] p-5 sm:p-6">
      <div className="mb-6">
        <h2 className="text-lg font-bold">{title}</h2>

        <p className="mt-1 text-xs text-zinc-500">{subtitle}</p>
      </div>

      {locked ? (
        <div className="flex items-center gap-3 rounded-lg border border-white/[0.08] bg-black/30 px-4 py-4 text-sm text-zinc-500">
          <Lock size={16} className="shrink-0 text-zinc-600" />
          {lockedMessage}
        </div>
      ) : (
        <fieldset disabled={false}>{children}</fieldset>
      )}
    </div>
  );
}

/* =========================================================
   NEXT STEP BUTTON
========================================================= */

function NextStepButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`
          flex h-11 w-full max-w-sm items-center justify-center gap-2
          rounded-lg text-sm font-semibold transition
          ${
            disabled
              ? "cursor-not-allowed bg-zinc-800 text-zinc-600"
              : "bg-violet-600 text-white hover:bg-violet-500"
          }
        `}
      >
        {children}
      </button>
    </div>
  );
}

/* =========================================================
   SOCIAL PILL
========================================================= */

function SocialPill({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <span className="flex items-center gap-1.5 rounded-full border border-white/[0.1] bg-white/[0.03] px-2.5 py-1 text-[11px] font-medium text-zinc-300">
      {icon}
      {label}
    </span>
  );
}

/* =========================================================
   STEP NAV ITEM (left sidebar)
========================================================= */

type StepState = "completed" | "active" | "locked";

type StepNavItemProps = {
  step: number;
  label: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  state: StepState;
  isActive: boolean;
  onClick: () => void;
  lockedHint?: string;
};

function StepNavItem({
  label,
  title,
  description,
  icon,
  state,
  isActive,
  onClick,
  lockedHint,
}: StepNavItemProps) {
  const locked = state === "locked";
  const completed = state === "completed";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={locked}
      className={`
        w-full rounded-xl border p-5 text-left transition
        ${
          isActive
            ? "border-violet-500/70 bg-violet-500/[0.05] shadow-lg shadow-violet-900/10"
            : completed
              ? "border-green-500/20 bg-green-500/[0.03] hover:border-green-500/40"
              : "border-white/[0.08] bg-white/[0.02]"
        }
        ${locked ? "cursor-not-allowed opacity-50" : "cursor-pointer"}
      `}
    >
      <div className="flex items-start gap-4">
        {/* Icon */}
        <div
          className={`
            flex h-11 w-11 shrink-0 items-center justify-center rounded-xl
            ${
              isActive
                ? "bg-violet-600 text-white"
                : completed
                  ? "bg-green-500/15 text-green-400"
                  : "bg-zinc-800 text-zinc-500"
            }
          `}
        >
          {locked ? <Lock size={19} /> : completed ? <Check size={19} strokeWidth={2.5} /> : icon}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold tracking-wider text-zinc-500">
              {label}
            </span>

            {completed && (
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-green-500 text-black">
                <Check size={12} strokeWidth={3} />
              </div>
            )}

            {locked && <Lock size={14} className="text-zinc-600" />}
          </div>

          <h3
            className={`mt-1 text-sm font-bold ${
              locked ? "text-zinc-500" : "text-white"
            }`}
          >
            {title}
          </h3>

          <p className="mt-1 text-[11px] leading-4 text-zinc-500">
            {locked && lockedHint ? lockedHint : description}
          </p>
        </div>
      </div>
    </button>
  );
}

/* =========================================================
   INPUT
========================================================= */

type InputProps = {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  counter?: boolean;
  optional?: boolean;
  icon?: React.ReactNode;
};

function Input({
  label,
  placeholder,
  value,
  onChange,
  maxLength,
  counter,
  optional,
  icon,
}: InputProps) {
  return (
    <label className="block">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-zinc-300">
          {label}

          {optional && (
            <span className="ml-2 rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] font-medium text-zinc-500">
              Optional
            </span>
          )}
        </span>

        {counter && maxLength && (
          <span className="text-[10px] text-zinc-600">
            {value.length} / {maxLength}
          </span>
        )}
      </div>

      <div className="relative">
        {icon && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600">
            {icon}
          </span>
        )}

        <input
          type="text"
          value={value}
          placeholder={placeholder}
          maxLength={maxLength}
          onChange={(e) => onChange(e.target.value)}
          className={`
            h-11 w-full rounded-lg border border-white/[0.1]
            bg-black/40 ${icon ? "pl-9" : "px-3"} pr-3 text-sm text-white
            outline-none placeholder:text-zinc-700
            transition
            focus:border-violet-500/60
            focus:ring-2 focus:ring-violet-500/10
          `}
        />
      </div>
    </label>
  );
}

/* =========================================================
   TEXTAREA
========================================================= */

type TextareaProps = {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  optional?: boolean;
};

function Textarea({
  label,
  placeholder,
  value,
  onChange,
  maxLength,
  optional,
}: TextareaProps) {
  return (
    <label className="block">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-zinc-300">
          {label}

          {optional && (
            <span className="ml-2 rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] font-medium text-zinc-500">
              Optional
            </span>
          )}
        </span>

        {maxLength && (
          <span className="text-[10px] text-zinc-600">
            {value.length} / {maxLength}
          </span>
        )}
      </div>

      <textarea
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        className="
          w-full resize-none rounded-lg border border-white/[0.1]
          bg-black/40 px-3 py-3 text-sm text-white
          outline-none placeholder:text-zinc-700
          transition
          focus:border-violet-500/60
          focus:ring-2 focus:ring-violet-500/10
        "
      />
    </label>
  );
}
