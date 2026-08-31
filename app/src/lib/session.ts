import { SignJWT, jwtVerify } from "jose";

const secret = process.env.SESSION_SECRET;

if (!secret) {
  throw new Error("SESSION_SECRET is missing");
}

const secretKey = new TextEncoder().encode(secret);

export interface XUser {
  id: string;
  name: string;
  username: string;
  profile_image_url?: string;
  description?: string;
}

export async function createSession(user: XUser, accessToken: string) {
  return await new SignJWT({
    user,
    accessToken,
  })
    .setProtectedHeader({
      alg: "HS256",
    })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secretKey);
}

export async function getSession(token: string) {
  try {
    const { payload } = await jwtVerify(token, secretKey);

    return {
      user: payload.user as XUser,
      accessToken: payload.accessToken as string,
    };
  } catch {
    return null;
  }
}
