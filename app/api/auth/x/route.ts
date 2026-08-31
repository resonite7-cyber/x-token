import { NextResponse } from "next/server";
import crypto from "crypto";

function base64UrlEncode(buffer: Buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

export async function GET() {
  const clientId = process.env.X_CLIENT_ID;
  const redirectUri = process.env.X_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      {
        success: false,
        message: "X OAuth environment variables are missing.",
      },
      { status: 500 },
    );
  }

  // Create PKCE verifier
  const codeVerifier = base64UrlEncode(crypto.randomBytes(32));

  // Create PKCE challenge
  const codeChallenge = base64UrlEncode(
    crypto.createHash("sha256").update(codeVerifier).digest(),
  );

  const state = base64UrlEncode(crypto.randomBytes(32));

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "users.read tweet.read offline.access",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  const response = NextResponse.redirect(
    `https://twitter.com/i/oauth2/authorize?${params.toString()}`,
  );

  // Save values temporarily for callback
  response.cookies.set("x_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });

  response.cookies.set("x_code_verifier", codeVerifier, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });

  return response;
}
