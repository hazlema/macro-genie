import { createHmac, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { UserFacingError } from "./errors.js";

// Sessions are a signed cookie holding the account id and an expiry; there's
// no session table. SESSION_SECRET signs them (any long random string).
const COOKIE = "mg_session";
const DAYS = 30;

const secret = () => {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32)
    throw new UserFacingError("Sign-in isn't set up yet.", 503);
  return value;
};
const sign = (body) =>
  createHmac("sha256", secret()).update(body).digest("base64url");

export function sessionCookie(accountId, request, now = Date.now()) {
  const body = Buffer.from(
    JSON.stringify({ a: accountId, e: now + DAYS * 86_400_000 }),
  ).toString("base64url");
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=${body}.${sign(body)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DAYS * 86_400}${secure}`;
}

export const clearCookie = `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

// The signed-in account id, or null.
export function readSession(request, now = Date.now()) {
  const value = (request.headers.get("cookie") ?? "")
    .split(/;\s*/)
    .find((c) => c.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  if (!value) return null;
  const [body, mac] = value.split(".");
  if (!body || !mac) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given))
    return null;
  try {
    const { a, e } = JSON.parse(Buffer.from(body, "base64url").toString());
    return Number.isInteger(a) && e > now ? a : null;
  } catch {
    return null;
  }
}

// Google's "Sign in with Google" hands the page a signed ID token. Checking
// its signature against Google's published keys proves who the person is.
let googleKeys = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);

// Tests sign their own tokens and hand in the matching keys.
export function useGoogleKeys(keys) {
  googleKeys = keys;
}

export async function verifyGoogleToken(token, keys = googleKeys) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new UserFacingError("Sign-in isn't set up yet.", 503);
  let payload;
  try {
    ({ payload } = await jwtVerify(String(token), keys, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: clientId,
    }));
  } catch (err) {
    // The person only sees "try again"; the log says why.
    console.warn("Google sign-in rejected:", err.code ?? err.message);
    throw new UserFacingError(
      "Google sign-in didn't go through. Try again.",
      401,
    );
  }
  if (!payload.sub)
    throw new UserFacingError(
      "Google sign-in didn't go through. Try again.",
      401,
    );
  // Only a first name is kept, for display; the email is never stored.
  const first = String(payload.given_name || payload.name || "")
    .trim()
    .split(/\s+/)[0];
  return {
    sub: String(payload.sub),
    displayName: first.slice(0, 40) || "Cook",
  };
}
