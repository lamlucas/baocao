import type { Env } from "../env";
import { sessionCookieHeader, signSession } from "../lib/session";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  let body: { username?: string; password?: string };
  try {
    body = (await request.json()) as { username?: string; password?: string };
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const u = (body.username ?? "").trim();
  const p = body.password ?? "";
  if (!u || !p) return Response.json({ error: "Thiếu tài khoản hoặc mật khẩu" }, { status: 400 });
  if (u !== env.ADMIN_USERNAME || !timingSafeEqual(p, env.ADMIN_PASSWORD)) {
    return Response.json({ error: "Sai tài khoản hoặc mật khẩu" }, { status: 401 });
  }
  const token = await signSession(env, u);
  const secure = new URL(request.url).protocol === "https:";
  return Response.json({ ok: true }, {
    headers: { "Set-Cookie": sessionCookieHeader(token, secure) },
  });
};
