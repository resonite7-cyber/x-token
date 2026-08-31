import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const { name, symbol, totalSupply, walletAddress, chainId, xUser } = body;

    // -----------------------------
    // VALIDATION
    // -----------------------------

    if (!name || !symbol || !totalSupply) {
      return NextResponse.json(
        {
          success: false,
          message: "Token name, symbol and total supply are required.",
        },
        { status: 400 },
      );
    }

    if (!walletAddress) {
      return NextResponse.json(
        {
          success: false,
          message: "Wallet address is required.",
        },
        { status: 400 },
      );
    }

    // Base Sepolia
    if (chainId !== 84532) {
      return NextResponse.json(
        {
          success: false,
          message: "Please use Base Sepolia testnet.",
        },
        { status: 400 },
      );
    }

    // Validate token name
    if (typeof name !== "string") {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid token name.",
        },
        { status: 400 },
      );
    }

    // Validate symbol
    if (typeof symbol !== "string" || !/^[a-zA-Z0-9]+$/.test(symbol)) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid token symbol.",
        },
        { status: 400 },
      );
    }

    // Validate supply
    const supply = BigInt(totalSupply);

    if (supply <= 0n) {
      return NextResponse.json(
        {
          success: false,
          message: "Total supply must be greater than zero.",
        },
        { status: 400 },
      );
    }

    // -----------------------------
    // LOG REQUEST
    // -----------------------------

    console.log("Token launch request:", {
      name,
      symbol,
      totalSupply: supply.toString(),
      walletAddress,
      chainId,
      xUser,
    });

    // -----------------------------
    // IMPORTANT
    // -----------------------------
    //
    // We DO NOT deploy the contract here.
    //
    // The user's connected wallet will
    // deploy the contract from page.tsx.
    //
    // This API is only validating the
    // token launch request.
    //

    return NextResponse.json(
      {
        success: true,

        message: "Token launch request validated.",

        token: {
          name,
          symbol: symbol.toUpperCase(),
          totalSupply: supply.toString(),
        },

        walletAddress,

        chainId,

        xUser,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Token validation error:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Invalid token launch request.",
      },
      { status: 500 },
    );
  }
}
