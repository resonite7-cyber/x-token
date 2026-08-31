import { createSession } from "@/app/src/lib/session";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      new URL(`/?error=${encodeURIComponent(error)}`, request.url),
    );
  }

  if (!code || !state) {
    return NextResponse.json(
      {
        success: false,
        message: "Missing authorization code or state.",
      },
      { status: 400 },
    );
  }

  const savedState = request.cookies.get("x_oauth_state")?.value;

  const codeVerifier = request.cookies.get("x_code_verifier")?.value;

  if (!savedState || !codeVerifier) {
    return NextResponse.json(
      {
        success: false,
        message: "OAuth session expired.",
      },
      { status: 400 },
    );
  }

  if (state !== savedState) {
    return NextResponse.json(
      {
        success: false,
        message: "Invalid OAuth state.",
      },
      { status: 400 },
    );
  }

  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;
  const redirectUri = process.env.X_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.json(
      {
        success: false,
        message: "X OAuth configuration is missing.",
      },
      { status: 500 },
    );
  }

  try {
    /*
     * Exchange authorization code for X access token
     */
    const tokenResponse = await fetch("https://api.x.com/2/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",

        Authorization:
          "Basic " +
          Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
      },

      body: new URLSearchParams({
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      console.error("X token error:", tokenData);

      return NextResponse.json(
        {
          success: false,
          message: "Failed to get X access token.",
        },
        { status: 400 },
      );
    }

    const accessToken = tokenData.access_token;

    /*
     * Get X account information
     */
    const userResponse = await fetch(
      "https://api.x.com/2/users/me?user.fields=id,name,username,profile_image_url,description",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    const userData = await userResponse.json();

    if (!userResponse.ok) {
      console.error("X user error:", userData);

      return NextResponse.json(
        {
          success: false,
          message: "Failed to get X account.",
        },
        { status: 400 },
      );
    }

    const user = userData.data;

    /*
     * Create encrypted session
     */
    const sessionToken = await createSession(user, accessToken);

    /*
     * Redirect back to application
     */
    const response = NextResponse.redirect(new URL("/", request.url));

    /*
     * Secure session cookie
     */
    response.cookies.set("x_session", sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });

    /*
     * Remove temporary OAuth cookies
     */
    response.cookies.delete("x_oauth_state");
    response.cookies.delete("x_code_verifier");

    return response;
  } catch (error) {
    console.error("X OAuth error:", error);

    return NextResponse.json(
      {
        success: false,
        message: "X authentication failed.",
      },
      { status: 500 },
    );
  }
}
