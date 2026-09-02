/*
 * ABIs for the Pons launchpad on Robinhood Chain.
 *
 * PONS_FACTORY_ABI is a verbatim subset of the official artifact published at
 * github.com/ponsdotdev/ponsfamily (abi.json, PonsLaunchFactory, solc 0.8.30)
 * — trimmed to the entries this app calls, with nothing retyped by hand.
 *
 * The Uniswap ABIs below are the canonical V3 periphery shapes. The router is
 * SwapRouter02: its exactInputSingle struct has NO deadline field, which was
 * confirmed both by getDexConfig(0).routerRequiresDeadline === false and by
 * finding selector 0x04e45aaf (and not 0x414bf389) in its deployed bytecode.
 */

export const PONS_FACTORY_ABI = 
[
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "token",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "deployer",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "dexFactory",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "pairToken",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "pool",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "dexId",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "launchConfigId",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "positionId",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "restrictionsEndBlock",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "initialBuyAmount",
        "type": "uint256"
      }
    ],
    "name": "TokenLaunched",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "dexConfigCount",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      }
    ],
    "name": "getDexConfig",
    "outputs": [
      {
        "components": [
          {
            "internalType": "string",
            "name": "name",
            "type": "string"
          },
          {
            "internalType": "address",
            "name": "factory",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "positionManager",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "swapRouter",
            "type": "address"
          },
          {
            "internalType": "uint24",
            "name": "poolFee",
            "type": "uint24"
          },
          {
            "internalType": "int24",
            "name": "tickSpacing",
            "type": "int24"
          },
          {
            "internalType": "bool",
            "name": "enabled",
            "type": "bool"
          }
        ],
        "internalType": "struct PonsLaunchFactory.DexConfig",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      }
    ],
    "name": "getLaunchConfig",
    "outputs": [
      {
        "components": [
          {
            "internalType": "address",
            "name": "pairToken",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "graduationThreshold",
            "type": "uint256"
          },
          {
            "internalType": "int24",
            "name": "initialTick",
            "type": "int24"
          },
          {
            "internalType": "uint256",
            "name": "supply",
            "type": "uint256"
          },
          {
            "internalType": "uint16",
            "name": "maxWalletBps",
            "type": "uint16"
          },
          {
            "internalType": "uint16",
            "name": "maxTxBps",
            "type": "uint16"
          },
          {
            "internalType": "uint32",
            "name": "restrictionBlocks",
            "type": "uint32"
          },
          {
            "internalType": "uint24",
            "name": "reservedFee",
            "type": "uint24"
          },
          {
            "internalType": "bool",
            "name": "enabled",
            "type": "bool"
          },
          {
            "internalType": "bool",
            "name": "routerRequiresDeadline",
            "type": "bool"
          }
        ],
        "internalType": "struct PonsLaunchFactory.LaunchConfig",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "token",
        "type": "address"
      }
    ],
    "name": "getLaunchedToken",
    "outputs": [
      {
        "components": [
          {
            "internalType": "address",
            "name": "token",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "deployer",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "pairedToken",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "positionManager",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "positionId",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "dexId",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "launchConfigId",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "restrictionsEndBlock",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "supply",
            "type": "uint256"
          },
          {
            "internalType": "bool",
            "name": "isToken0",
            "type": "bool"
          },
          {
            "internalType": "uint24",
            "name": "poolFee",
            "type": "uint24"
          },
          {
            "internalType": "bool",
            "name": "exists",
            "type": "bool"
          },
          {
            "internalType": "uint256",
            "name": "initialBuyAmount",
            "type": "uint256"
          }
        ],
        "internalType": "struct IPonsLaunchFactory.LaunchedToken",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "token",
        "type": "address"
      }
    ],
    "name": "graduationStatus",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "pairedPrincipal",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "threshold",
        "type": "uint256"
      },
      {
        "internalType": "bool",
        "name": "graduated",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "launchConfigCount",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "launchEnabled",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "launchFee",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "components": [
          {
            "internalType": "string",
            "name": "name",
            "type": "string"
          },
          {
            "internalType": "string",
            "name": "symbol",
            "type": "string"
          },
          {
            "internalType": "string",
            "name": "logo",
            "type": "string"
          },
          {
            "internalType": "string",
            "name": "description",
            "type": "string"
          },
          {
            "components": [
              {
                "internalType": "string",
                "name": "twitter",
                "type": "string"
              },
              {
                "internalType": "string",
                "name": "telegram",
                "type": "string"
              },
              {
                "internalType": "string",
                "name": "discord",
                "type": "string"
              },
              {
                "internalType": "string",
                "name": "website",
                "type": "string"
              },
              {
                "internalType": "string",
                "name": "farcaster",
                "type": "string"
              }
            ],
            "internalType": "struct PonsLaunchFactory.Socials",
            "name": "socials",
            "type": "tuple"
          },
          {
            "internalType": "address",
            "name": "feeWallet",
            "type": "address"
          }
        ],
        "internalType": "struct PonsLaunchFactory.TokenParams",
        "name": "params",
        "type": "tuple"
      },
      {
        "internalType": "uint256",
        "name": "launchConfigId",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "dexId",
        "type": "uint256"
      },
      {
        "internalType": "bytes32",
        "name": "salt",
        "type": "bytes32"
      }
    ],
    "name": "launchToken",
    "outputs": [
      {
        "internalType": "address",
        "name": "token",
        "type": "address"
      }
    ],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "locker",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "components": [
          {
            "internalType": "string",
            "name": "name",
            "type": "string"
          },
          {
            "internalType": "string",
            "name": "symbol",
            "type": "string"
          },
          {
            "internalType": "string",
            "name": "logo",
            "type": "string"
          },
          {
            "internalType": "string",
            "name": "description",
            "type": "string"
          },
          {
            "components": [
              {
                "internalType": "string",
                "name": "twitter",
                "type": "string"
              },
              {
                "internalType": "string",
                "name": "telegram",
                "type": "string"
              },
              {
                "internalType": "string",
                "name": "discord",
                "type": "string"
              },
              {
                "internalType": "string",
                "name": "website",
                "type": "string"
              },
              {
                "internalType": "string",
                "name": "farcaster",
                "type": "string"
              }
            ],
            "internalType": "struct PonsLaunchFactory.Socials",
            "name": "socials",
            "type": "tuple"
          },
          {
            "internalType": "address",
            "name": "feeWallet",
            "type": "address"
          }
        ],
        "internalType": "struct PonsLaunchFactory.TokenParams",
        "name": "params",
        "type": "tuple"
      },
      {
        "internalType": "uint256",
        "name": "launchConfigId",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "dexId",
        "type": "uint256"
      },
      {
        "internalType": "bytes32",
        "name": "salt",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "tokenDeployer",
        "type": "address"
      }
    ],
    "name": "predictTokenAddress",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;

/** PonsLauncherToken — ERC-20 plus on-chain metadata. No IPFS JSON document. */
export const PONS_TOKEN_ABI = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "logo", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "description", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "liquidityPool", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  {
    type: "function", name: "socials", stateMutability: "view", inputs: [],
    outputs: [
      { name: "twitter", type: "string" },
      { name: "telegram", type: "string" },
      { name: "discord", type: "string" },
      { name: "website", type: "string" },
      { name: "farcaster", type: "string" },
    ],
  },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

export const QUOTER_V2_ABI = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "nonpayable",
    inputs: [
      {
        type: "tuple",
        name: "params",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "fee", type: "uint24" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96After", type: "uint160" },
      { name: "initializedTicksCrossed", type: "uint32" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;

export const SWAP_ROUTER_02_ABI = [
  {
    type: "function",
    name: "exactInputSingle",
    stateMutability: "payable",
    inputs: [
      {
        type: "tuple",
        name: "params",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
  { type: "function", name: "multicall", stateMutability: "payable", inputs: [{ name: "data", type: "bytes[]" }], outputs: [{ type: "bytes[]" }] },
  { type: "function", name: "refundETH", stateMutability: "payable", inputs: [], outputs: [] },
  { type: "function", name: "unwrapWETH9", stateMutability: "payable", inputs: [{ name: "amountMinimum", type: "uint256" }, { name: "recipient", type: "address" }], outputs: [] },
] as const;

export const UNISWAP_V3_POOL_ABI = [
  {
    type: "function", name: "slot0", stateMutability: "view", inputs: [],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "observationIndex", type: "uint16" },
      { name: "observationCardinality", type: "uint16" },
      { name: "observationCardinalityNext", type: "uint16" },
      { name: "feeProtocol", type: "uint8" },
      { name: "unlocked", type: "bool" },
    ],
  },
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "liquidity", stateMutability: "view", inputs: [], outputs: [{ type: "uint128" }] },
  {
    type: "event", name: "Swap", anonymous: false,
    inputs: [
      { name: "sender", type: "address", indexed: true },
      { name: "recipient", type: "address", indexed: true },
      { name: "amount0", type: "int256", indexed: false },
      { name: "amount1", type: "int256", indexed: false },
      { name: "sqrtPriceX96", type: "uint160", indexed: false },
      { name: "liquidity", type: "uint128", indexed: false },
      { name: "tick", type: "int24", indexed: false },
    ],
  },
] as const;
