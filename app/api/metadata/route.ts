import { NextResponse } from "next/server";

// Pump.fun's public IPFS endpoint — the same one pump.fun's own token
// creation UI uses. It pins the image, builds the standard token metadata
// JSON, pins that too, and returns a metadataUri ready for the on-chain
// create instruction. No API key required.
const PUMP_IPFS_ENDPOINT = "https://pump.fun/api/ipfs";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

interface PumpIpfsResponse {
  metadataUri?: string;
  metadata?: { image?: string };
}

// pump.fun/api/ipfs returns image URLs on the ipfs.io public gateway, which
// is frequently slow or unreachable. The same content is also pinned on
// Pinata (the gateway pump.fun's own site actually uses), so swap the host
// for a gateway that reliably resolves the image in our UI.
const RELIABLE_IPFS_GATEWAY = "https://pump.mypinata.cloud/ipfs/";

function toReliableGatewayUrl(uri: string): string {
  const match = uri.match(/\/ipfs\/([^/?#]+)/);

  if (!match) {
    return uri;
  }

  return `${RELIABLE_IPFS_GATEWAY}${match[1]}`;
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();

    const image = form.get("image");

    const name = String(form.get("name") ?? "").trim();
    const symbol = String(form.get("symbol") ?? "").trim();
    const description = String(form.get("description") ?? "").trim();
    const website = String(form.get("website") ?? "").trim();
    const twitter = String(form.get("twitter") ?? "").trim();
    const telegram = String(form.get("telegram") ?? "").trim();

    if (!name || !symbol || !description) {
      return NextResponse.json(
        {
          success: false,
          message: "Token name, symbol and description are required.",
        },
        { status: 400 },
      );
    }

    if (!(image instanceof File) || image.size === 0) {
      return NextResponse.json(
        { success: false, message: "A token image is required." },
        { status: 400 },
      );
    }

    if (!ALLOWED_IMAGE_TYPES.has(image.type)) {
      return NextResponse.json(
        {
          success: false,
          message: "Image must be PNG, JPEG, GIF, or WEBP.",
        },
        { status: 400 },
      );
    }

    if (image.size > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { success: false, message: "Image must be 5MB or smaller." },
        { status: 400 },
      );
    }

    const uploadForm = new FormData();

    uploadForm.set("file", image, image.name || "token-image");
    uploadForm.set("name", name);
    uploadForm.set("symbol", symbol);
    uploadForm.set("description", description);
    uploadForm.set("showName", "true");

    if (website) uploadForm.set("website", website);
    if (twitter) uploadForm.set("twitter", twitter);
    if (telegram) uploadForm.set("telegram", telegram);

    const uploadRes = await fetch(PUMP_IPFS_ENDPOINT, {
      method: "POST",
      body: uploadForm,
    });

    if (!uploadRes.ok) {
      const text = await uploadRes.text().catch(() => "");

      console.error("Metadata upload failed:", uploadRes.status, text);

      return NextResponse.json(
        {
          success: false,
          message: "Failed to upload token metadata. Please try again.",
        },
        { status: 502 },
      );
    }

    const data = (await uploadRes.json()) as PumpIpfsResponse;

    if (!data.metadataUri) {
      return NextResponse.json(
        {
          success: false,
          message: "Metadata upload did not return a valid URI.",
        },
        { status: 502 },
      );
    }

    const rawImageUri = data.metadata?.image ?? "";

    return NextResponse.json({
      success: true,
      metadataUri: data.metadataUri,
      imageUri: rawImageUri ? toReliableGatewayUrl(rawImageUri) : "",
    });
  } catch (error) {
    console.error("Metadata upload error:", error);

    return NextResponse.json(
      { success: false, message: "Failed to prepare token metadata." },
      { status: 500 },
    );
  }
}
