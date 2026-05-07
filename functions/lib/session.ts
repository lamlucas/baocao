import type { Env } from "../env";

const COOKIE = "bc_session";
const MAX_AGE_SEC = 60 * 60 * 24 * 7;

function encoder() {
  return new TextEncoder();
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

export async function signSession(env: Env, username: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SEC;
  const payload = `${username}:${exp}`;
  const sig = await hmac(env.SESSION_SECRET, payload);
  return btoa(payload + ":" + sig);
}

export async function verifySession(
  env: Env,
  cookieHeader: string | null,
): Promise<string | null> {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";").map((p) => p.trim());
  const pair = parts.find((p) => p.startsWith(COOKIE + "="));
  if (!pair) return null;
  const value = decodeURIComponent(pair.slice(COOKIE.length + 1));
  let decoded: string;
  try {
    decoded = atob(value);
  } catch {
    return null;
  }
  const lastColon = decoded.lastIndexOf(":");
  if (lastColon < 0) return null;
  const sig = decoded.slice(lastColon + 1);
  const rest = decoded.slice(0, lastColon);
  const prevColon = rest.lastIndexOf(":");
  if (prevColon < 0) return null;
  const user = rest.slice(0, prevColon);
  const expStr = rest.slice(prevColon + 1);
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;
  const expected = await hmac(env.SESSION_SECRET, `${user}:${exp}`);
  if (expected !== sig) return null;
  if (user !== env.ADMIN_USERNAME) return null;
  return user;
}

export function sessionCookieHeader(token: string, secure: boolean): string {
  const sec = secure ? " Secure;" : "";
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly;${sec} SameSite=Lax; Max-Age=${MAX_AGE_SEC}`;
}

export function clearSessionCookieHeader(secure: boolean): string {
  const sec = secure ? " Secure;" : "";
  return `${COOKIE}=; Path=/; HttpOnly;${sec} SameSite=Lax; Max-Age=0`;
}
