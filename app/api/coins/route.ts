import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

import { NextResponse } from "next/server";

interface CreatedCoin {
  name: string;
  symbol: string;
  mint: string;
  creatorWallet: string;
  createdAt: string;
  image?: string;
}

const DATA_FILE = path.join(process.cwd(), "data", "created-coins.json");

async function readCoins(): Promise<CreatedCoin[]> {
  try {
    const raw = await readFile(DATA_FILE, "utf-8");
    return JSON.parse(raw) as CreatedCoin[];
  } catch {
    return [];
  }
}

async function writeCoins(coins: CreatedCoin[]): Promise<void> {
  await mkdir(path.dirname(DATA_FILE), { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(coins, null, 2), "utf-8");
}

export async function GET() {
  const coins = await readCoins();

  return NextResponse.json({ coins: coins.reverse() });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const { name, symbol, mint, creatorWallet, image } = body;

    if (
      typeof name !== "string" ||
      typeof symbol !== "string" ||
      typeof mint !== "string" ||
      typeof creatorWallet !== "string" ||
      (image !== undefined && typeof image !== "string")
    ) {
      return NextResponse.json(
        { success: false, message: "Invalid coin record." },
        { status: 400 },
      );
    }

    const coins = await readCoins();

    coins.push({
      name,
      symbol,
      mint,
      creatorWallet,
      createdAt: new Date().toISOString(),
      ...(image ? { image } : {}),
    });

    await writeCoins(coins);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to record created coin:", error);

    return NextResponse.json(
      { success: false, message: "Failed to record coin." },
      { status: 500 },
    );
  }
}
