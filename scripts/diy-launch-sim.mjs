import { createPublicClient, http, encodeDeployData, parseEther, getContractAddress } from "viem";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const artifact = require("../artifacts/contracts/Token.sol/Token.json");

const RPC = "https://rpc.mainnet.chain.robinhood.com";
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const NPM  = "0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3"; // NonfungiblePositionManager
const DEPLOYER = "0x3333333333333333333333333333333333333333";
const FEE = 3000, SPACING = 60;
const MIN_TICK = -Math.floor(887272 / SPACING) * SPACING;
const MAX_TICK =  Math.floor(887272 / SPACING) * SPACING;

const SUPPLY = 1_000_000_000n;                    // whole tokens, ctor multiplies by 1e18
const TOKENS_TO_POOL = 200_000_000n * 10n ** 18n; // 20% into the pool
const ETH_TO_POOL = parseEther("0.1");

const client = createPublicClient({ chain: robinhood(), transport: http(RPC) });
function robinhood() {
  return { id: 4663, name: "Robinhood", nativeCurrency:{name:"Ether",symbol:"ETH",decimals:18}, rpcUrls:{default:{http:[RPC]}} };
}

const ERC20 = [
  {name:"approve",type:"function",stateMutability:"nonpayable",inputs:[{name:"s",type:"address"},{name:"a",type:"uint256"}],outputs:[{type:"bool"}]},
  {name:"balanceOf",type:"function",stateMutability:"view",inputs:[{name:"a",type:"address"}],outputs:[{type:"uint256"}]},
  {name:"deposit",type:"function",stateMutability:"payable",inputs:[],outputs:[]},
];
const NPM_ABI = [
  {name:"createAndInitializePoolIfNecessary",type:"function",stateMutability:"payable",
   inputs:[{name:"token0",type:"address"},{name:"token1",type:"address"},{name:"fee",type:"uint24"},{name:"sqrtPriceX96",type:"uint160"}],
   outputs:[{name:"pool",type:"address"}]},
  {name:"mint",type:"function",stateMutability:"payable",
   inputs:[{components:[
     {name:"token0",type:"address"},{name:"token1",type:"address"},{name:"fee",type:"uint24"},
     {name:"tickLower",type:"int24"},{name:"tickUpper",type:"int24"},
     {name:"amount0Desired",type:"uint256"},{name:"amount1Desired",type:"uint256"},
     {name:"amount0Min",type:"uint256"},{name:"amount1Min",type:"uint256"},
     {name:"recipient",type:"address"},{name:"deadline",type:"uint256"}],name:"params",type:"tuple"}],
   outputs:[{name:"tokenId",type:"uint256"},{name:"liquidity",type:"uint128"},{name:"amount0",type:"uint256"},{name:"amount1",type:"uint256"}]},
];

// integer sqrt for sqrtPriceX96
function isqrt(n){ if(n<2n) return n; let x=n, y=(x+1n)/2n; while(y<x){x=y;y=(x+n/x)/2n;} return x; }

const token = getContractAddress({ from: DEPLOYER, nonce: 0n });
const [token0, token1] = token.toLowerCase() < WETH.toLowerCase() ? [token, WETH] : [WETH, token];
const [amt0, amt1] = token0 === token ? [TOKENS_TO_POOL, ETH_TO_POOL] : [ETH_TO_POOL, TOKENS_TO_POOL];
// sqrtPriceX96 = sqrt(amt1/amt0) * 2^96
const sqrtPriceX96 = isqrt((amt1 << 192n) / amt0);

const deployData = encodeDeployData({
  abi: artifact.abi, bytecode: artifact.bytecode,
  args: ["My Token", "MTK", SUPPLY, DEPLOYER],
});

const calls = [
  { to: null, data: deployData },
  { to: WETH,  abi: ERC20, functionName: "deposit", value: ETH_TO_POOL },
  { to: WETH,  abi: ERC20, functionName: "approve", args: [NPM, ETH_TO_POOL] },
  { to: token, abi: ERC20, functionName: "approve", args: [NPM, TOKENS_TO_POOL] },
  { to: NPM, abi: NPM_ABI, functionName: "createAndInitializePoolIfNecessary", args: [token0, token1, FEE, sqrtPriceX96] },
  { to: NPM, abi: NPM_ABI, functionName: "mint", args: [{
      token0, token1, fee: FEE, tickLower: MIN_TICK, tickUpper: MAX_TICK,
      amount0Desired: amt0, amount1Desired: amt1, amount0Min: 0n, amount1Min: 0n,
      recipient: DEPLOYER, deadline: BigInt(Math.floor(Date.now()/1000)+3600) }] },
  { to: token, abi: ERC20, functionName: "balanceOf", args: [DEPLOYER] },
];

const { results } = await client.simulateCalls({
  account: DEPLOYER,
  stateOverrides: [{ address: DEPLOYER, balance: parseEther("10") }],
  calls,
});

const labels = ["deploy Token","wrap ETH→WETH","approve WETH","approve TOKEN","create+init pool","mint LP position","creator balance"];
results.forEach((r,i)=>{
  const extra = r.status!=="success" ? ` ${JSON.stringify(r.error?.message ?? r.error ?? "").slice(0,160)}` : "";
  console.log(`${String(i+1).padStart(2)}. ${labels[i].padEnd(20)} ${r.status}  gas ${(r.gasUsed ?? 0n).toString().padStart(9)}${extra}`);
});
console.log("\ntoken      ", token);
console.log("pool       ", results[4]?.result);
const m = results[5]?.result;
if (m) console.log("tokenId", m[0], "liquidity", m[1]);
const totalGas = results.reduce((a,r)=>a+(r.gasUsed ?? 0n), 0n);
const gasPrice = await client.getGasPrice();
console.log(`\ntotal gas ${totalGas}  @ ${gasPrice} wei  = ${Number(totalGas*gasPrice)/1e18} ETH`);
console.log("creator left", results[6]?.result ? (results[6].result / 10n**18n).toLocaleString() : "-");
