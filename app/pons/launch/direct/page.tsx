"use client";

import { useMemo, useState } from "react";

import { ExternalLink, FlaskConical, Rocket } from "lucide-react";

import { formatEther, parseEther, type Address } from "viem";
import {
  useAccount,
  useDeployContract,
  usePublicClient,
  useWriteContract,
} from "wagmi";

import EvmWalletButton from "../../../components/EvmWalletButton";
import LaunchTabs from "../../../components/LaunchTabs";

import { POOL_FEE } from "../../../src/lib/pons/addresses";

import { PAGE_CONTAINER } from "../../../src/ui";
import {
  explorerTokenUrl,
  explorerTxUrl,
  robinhoodChain,
} from "../../../src/lib/pons/chain";
import {
  LAUNCH_STEP_LABELS,
  buildLaunchSequence,
  buildPoolApprove,
  buildPoolCreation,
  buildTokenDeploy,
  getPoolAddress,
  openingFdvEth,
  openingPriceEth,
  predictDirectTokenAddress,
  type DirectLaunchParams,
} from "../../../src/lib/pons/directLaunch";

/*
 * Launches a token without Pons.
 *
 * The Pons factory is closed (launchEnabled = false, owner-only), so this page
 * does the same three things Pons does in one transaction, as three of its
 * own: deploy the ERC-20, approve the position manager, then create the pool
 * and mint a full-range LP position in a single multicall.
 *
 * The whole sequence is proven against live mainnet state in
 * test/direct.launch.ts via eth_simulateV1.
 */

const FEE_TIERS = [
  { fee: 500, label: "0.05%" },
  { fee: 3000, label: "0.3%" },
  { fee: 10000, label: "1% (Pons default)" },
];

type Step = "idle" | "deploying" | "approving" | "pooling" | "done";

interface Preview {
  ok: boolean;
  steps: { label: string; status: string; gas: bigint }[];
  token: Address;
  pool: Address | null;
  kept: bigint | null;
  gasCostWei: bigint;
  failure: string | null;
}

export default function DirectLaunchPage() {
  const { address: user, isConnected, chainId } = useAccount();
  const publicClient = usePublicClient({ chainId: robinhoodChain.id });

  const { deployContractAsync } = useDeployContract();
  const { writeContractAsync } = useWriteContract();

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [supply, setSupply] = useState("1000000000");
  const [pooled, setPooled] = useState("200000000");
  const [seedEth, setSeedEth] = useState("0.1");
  const [fee, setFee] = useState(POOL_FEE);

  const [step, setStep] = useState<Step>("idle");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [error, setError] = useState("");
  const [token, setToken] = useState<Address | null>(null);
  const [pool, setPool] = useState<Address | null>(null);
  const [txs, setTxs] = useState<`0x${string}`[]>([]);

  /** Parsed form, or null while it is still incomplete or malformed. */
  const params = useMemo<DirectLaunchParams | null>(() => {
    if (!user) return null;

    try {
      const totalSupply = BigInt(supply || "0");
      const tokensToPool = BigInt(pooled || "0");
      const ethToPool = parseEther(seedEth || "0");

      if (!name.trim() || !symbol.trim()) return null;
      if (totalSupply <= 0n) return null;
      if (tokensToPool <= 0n || tokensToPool > totalSupply) return null;
      if (ethToPool <= 0n) return null;

      return {
        name,
        symbol,
        totalSupply,
        tokensToPool,
        ethToPool,
        creator: user,
        fee,
      };
    } catch {
      return null;
    }
  }, [name, symbol, supply, pooled, seedEth, fee, user]);

  /**
   * Dry run. eth_simulateV1 executes the exact three calls against current
   * mainnet state using the connected wallet's real address, nonce and
   * balance — no signature, no funds moved. This is what stands in for a
   * testnet, since Robinhood Chain's testnet has no Uniswap deployed.
   */
  async function simulate() {
    if (!publicClient || !params || !user) return;

    setError("");
    setPreview(null);
    setSimulating(true);

    try {
      // A plain CREATE lands at an address derived from the sender's next
      // nonce, so the preview is only valid until this wallet sends anything.
      const [nonce, balance] = await Promise.all([
        publicClient.getTransactionCount({ address: user }),
        publicClient.getBalance({ address: user }),
      ]);

      // Checked up front so an underfunded wallet gets a number it can act on
      // rather than the node's raw "exceeds the balance of the account".
      if (balance <= params.ethToPool) {
        throw new Error(
          `Not enough ETH. This launch needs ${formatEther(params.ethToPool)} ` +
            `for liquidity plus about 0.003 for gas, but ${truncate(user)} holds ` +
            `${formatEther(balance)}. Lower the pool ETH or fund the wallet.`,
        );
      }

      const token = predictDirectTokenAddress(user, BigInt(nonce));

      const [simulated, gasPrice] = await Promise.all([
        publicClient.simulateCalls({
          account: user,
          calls: buildLaunchSequence({ token, params }) as never,
        }),
        publicClient.getGasPrice(),
      ]);

      // The `as never` on calls above (viem's tuple inference cannot follow a
      // dynamically built array) erases the result type with it.
      const results = simulated.results as unknown as {
        status: string;
        gasUsed?: bigint;
        result?: unknown;
      }[];

      const steps = results.map((r, i: number) => ({
        label: LAUNCH_STEP_LABELS[i],
        status: r.status,
        gas: r.gasUsed ?? 0n,
      }));

      const failed = steps.findIndex((s) => s.status !== "success");
      const gasUsed = steps.slice(0, 3).reduce((sum, s) => sum + s.gas, 0n);

      setPreview({
        ok: failed === -1,
        steps,
        token,
        pool: failed === -1 ? (results[3].result as Address) : null,
        kept: failed === -1 ? (results[4].result as bigint) : null,
        gasCostWei: gasUsed * gasPrice,
        failure: failed === -1 ? null : LAUNCH_STEP_LABELS[failed],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message.split("\n")[0] : "Simulation failed.");
    } finally {
      setSimulating(false);
    }
  }

  async function launch() {
    if (!publicClient || !params) return;

    setError("");
    setToken(null);
    setPool(null);
    setTxs([]);

    try {
      // 1. Deploy the ERC-20. The whole supply mints to the creator.
      setStep("deploying");

      const deploy = buildTokenDeploy(params);

      const deployHash = await deployContractAsync({
        abi: deploy.abi,
        bytecode: deploy.bytecode,
        args: deploy.args as never,
      });

      setTxs((prev) => [...prev, deployHash]);

      const receipt = await publicClient.waitForTransactionReceipt({ hash: deployHash });

      if (!receipt.contractAddress) {
        throw new Error("Deployment produced no contract address.");
      }

      const deployed = receipt.contractAddress;

      setToken(deployed);

      // 2. Let the position manager pull the pool's token side.
      setStep("approving");

      const approve = buildPoolApprove(deployed, params.tokensToPool);

      const approveHash = await writeContractAsync({
        address: approve.address,
        abi: approve.abi as never,
        functionName: approve.functionName as never,
        args: approve.args as never,
      });

      setTxs((prev) => [...prev, approveHash]);

      await publicClient.waitForTransactionReceipt({ hash: approveHash });

      // 3. Create the pool, mint the position and refund the change. The ETH
      //    side needs no wrap: the position manager wraps msg.value itself.
      setStep("pooling");

      const create = buildPoolCreation({ token: deployed, params });

      const poolHash = await writeContractAsync({
        address: create.address,
        abi: create.abi as never,
        functionName: create.functionName as never,
        args: create.args as never,
        value: create.value,
      });

      setTxs((prev) => [...prev, poolHash]);

      await publicClient.waitForTransactionReceipt({ hash: poolHash });

      setPool(await getPoolAddress({ client: publicClient, token: deployed, fee: params.fee }));
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message.split("\n")[0] : "Launch failed.");
      setStep("idle");
    }
  }

  const busy = step !== "idle" && step !== "done";
  const wrongChain = isConnected && chainId !== robinhoodChain.id;

  const stepLabel: Record<Step, string> = {
    idle: "Launch token",
    deploying: "1/3 Deploying token...",
    approving: "2/3 Approving liquidity...",
    pooling: "3/3 Creating pool...",
    done: "Launch again",
  };

  return (
    <main className="min-h-screen bg-[#05070b] text-white">
      <div className={PAGE_CONTAINER}>
        <LaunchTabs active="direct" />

        <h1 className="text-3xl font-bold tracking-tight">Launch directly</h1>

        <p className="mt-3 text-zinc-400">
          Deploys your ERC-20 and opens a Uniswap V3 pool for it on Robinhood
          Chain, skipping the Pons factory entirely. Three transactions, all
          signed by you.
        </p>

        <div className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          <strong className="font-semibold">You keep the liquidity position.</strong>{" "}
          Pons locks the LP; this does not. The position NFT lands in your
          wallet, so you can withdraw the pooled ETH at any time — and buyers
          can see that. Burn or lock it if you want them to trust the pool.
        </div>

        {error && (
          <div className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {step === "done" && token && (
          <div className="mt-6 space-y-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
            <div className="font-semibold">Launched.</div>
            <Row label="Token" value={token} href={explorerTokenUrl(token)} />
            {pool && <Row label="Pool" value={pool} />}
          </div>
        )}

        {txs.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {txs.map((hash, i) => (
              <a
                key={hash}
                href={explorerTxUrl(hash)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1 text-xs text-zinc-400 hover:text-white"
              >
                tx {i + 1} <ExternalLink size={11} />
              </a>
            ))}
          </div>
        )}

        <div className="mt-8 space-y-4 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" value={name} onChange={setName} placeholder="My Token" />
            <Field label="Symbol" value={symbol} onChange={setSymbol} placeholder="MTK" />
          </div>

          <Field
            label="Total supply (whole tokens)"
            value={supply}
            onChange={setSupply}
            placeholder="1000000000"
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Tokens into the pool"
              value={pooled}
              onChange={setPooled}
              placeholder="200000000"
            />
            <Field
              label="ETH into the pool"
              value={seedEth}
              onChange={setSeedEth}
              placeholder="0.1"
            />
          </div>

          <div>
            <label className="text-xs text-zinc-500">Pool fee</label>
            <div className="mt-1 flex gap-2">
              {FEE_TIERS.map((tier) => (
                <button
                  key={tier.fee}
                  onClick={() => setFee(tier.fee)}
                  className={`h-9 flex-1 rounded-lg border text-xs font-medium transition ${
                    fee === tier.fee
                      ? "border-violet-500/50 bg-violet-500/20 text-violet-200"
                      : "border-white/10 bg-black/40 text-zinc-400 hover:border-white/20"
                  }`}
                >
                  {tier.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1 rounded-lg bg-white/[0.03] px-3 py-2 text-xs text-zinc-400">
            {params ? (
              <>
                <div>
                  Opening price{" "}
                  <span className="text-zinc-200">
                    {openingPriceEth(params).toExponential(3)} ETH
                  </span>{" "}
                  per {symbol.toUpperCase() || "token"}
                </div>
                <div>
                  Starting FDV{" "}
                  <span className="text-zinc-200">
                    {formatEthAmount(openingFdvEth(params))} ETH
                  </span>
                </div>
                <div>
                  You pay {formatEther(params.ethToPool)} ETH of liquidity plus gas
                  (about 0.003 ETH at current prices).
                </div>
              </>
            ) : !user ? (
              // params is null whenever the wallet is missing, so without this
              // branch a fully completed form still read "fill in every field".
              "Connect your wallet to see the opening price."
            ) : (
              "Fill in every field to see the opening price."
            )}
          </div>

          {preview && (
            <div
              className={`space-y-2 rounded-lg border px-3 py-2 text-xs ${
                preview.ok
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : "border-red-500/30 bg-red-500/10 text-red-300"
              }`}
            >
              <div className="font-semibold">
                {preview.ok
                  ? "Dry run passed. Nothing was signed or spent."
                  : `Dry run failed at: ${preview.failure}`}
              </div>

              {preview.steps.map((s) => (
                <div key={s.label} className="flex justify-between gap-3">
                  <span>
                    {s.status === "success" ? "✓" : "✗"} {s.label}
                  </span>
                  <span className="tabular-nums opacity-70">
                    {s.gas > 0n ? `${s.gas.toLocaleString()} gas` : ""}
                  </span>
                </div>
              ))}

              {preview.ok && (
                <div className="space-y-1 border-t border-current/20 pt-2 opacity-90">
                  <Row label="Token" value={preview.token} />
                  {preview.pool && <Row label="Pool" value={preview.pool} />}
                  <div>
                    Gas cost {formatEther(preview.gasCostWei)} ETH, plus{" "}
                    {formatEther(params!.ethToPool)} ETH of liquidity.
                  </div>
                  {preview.kept !== null && (
                    <div>
                      You would keep{" "}
                      {Number(formatEther(preview.kept)).toLocaleString()}{" "}
                      {symbol.toUpperCase()}.
                    </div>
                  )}
                  <div className="opacity-70">
                    The token address assumes this is your wallet&apos;s next
                    transaction.
                  </div>
                </div>
              )}
            </div>
          )}

          {!isConnected || wrongChain ? (
            <EvmWalletButton />
          ) : (
            <div className="flex gap-2">
              <button
                onClick={simulate}
                disabled={busy || simulating || !params}
                className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] text-sm font-semibold text-zinc-300 transition hover:border-white/25 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <FlaskConical size={15} />
                {simulating ? "Simulating..." : "Dry run"}
              </button>

              <button
                onClick={launch}
                disabled={busy || !params}
                className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-violet-500/20 text-sm font-semibold text-violet-300 transition hover:bg-violet-500/30 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Rocket size={15} />
                {stepLabel[step]}
              </button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

/** Keeps small valuations readable without printing 0.0000 for all of them. */
function formatEthAmount(value: number): string {
  if (!Number.isFinite(value)) return "-";
  if (value === 0) return "0";
  if (value < 0.0001) return value.toExponential(3);

  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function truncate(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function Row({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 shrink-0 text-emerald-400/60">{label}</span>
      <code className="truncate font-mono text-xs">{value}</code>
      {href && (
        <a href={href} target="_blank" rel="noreferrer" className="shrink-0">
          <ExternalLink size={12} />
        </a>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="text-xs text-zinc-500">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 h-10 w-full rounded-lg border border-white/10 bg-black/40 px-3 text-sm outline-none focus:border-violet-500/50"
      />
    </div>
  );
}
