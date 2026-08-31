import { getSession } from "@/app/src/lib/session";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const sessionToken = request.cookies.get("x_session")?.value;

    if (!sessionToken) {
      return NextResponse.json(
        {
          authenticated: false,
          user: null,
        },
        { status: 401 },
      );
    }

    const session = await getSession(sessionToken);

    if (!session) {
      return NextResponse.json(
        {
          authenticated: false,
          user: null,
        },
        { status: 401 },
      );
    }

    return NextResponse.json({
      authenticated: true,
      user: session.user,
    });
  } catch (error) {
    console.error("Session error:", error);

    return NextResponse.json(
      {
        authenticated: false,
        user: null,
      },
      { status: 500 },
    );
  }
}
