import { SignJWT, importPKCS8 } from "jose";

type ServiceAccount = {
  client_email: string;
  private_key: string;
};

let cachedToken: { token: string; exp: number } | null = null;

function parseSa(json: string): ServiceAccount {
  const o = JSON.parse(json) as ServiceAccount;
  if (!o.client_email || !o.private_key) throw new Error("Invalid service account JSON");
  return o;
}

export async function getSheetsAccessToken(serviceAccountJson: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp > now + 60) return cachedToken.token;

  const sa = parseSa(serviceAccountJson);
  const key = await importPKCS8(sa.private_key.replace(/\\n/g, "\n"), "RS256");

  const jwt = await new SignJWT({
    scope: "https://www.googleapis.com/auth/spreadsheets",
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: jwt,
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Token error ${res.status}: ${t}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: data.access_token, exp: now + (data.expires_in ?? 3500) };
  return data.access_token;
}

export async function sheetsBatchGet(
  accessToken: string,
  spreadsheetId: string,
  ranges: string[],
): Promise<Record<string, string[][]>> {
  const u = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet`,
  );
  for (const r of ranges) u.searchParams.append("ranges", r);
  const res = await fetch(u.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`batchGet ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as {
    valueRanges?: { range?: string; values?: string[][] }[];
  };
  const out: Record<string, string[][]> = {};
  for (const vr of json.valueRanges ?? []) {
    const range = vr.range ?? "";
    const raw = range.split("!")[0] ?? "";
    const name = raw.replace(/^'+|'+$/g, "");
    out[name] = vr.values ?? [];
  }
  return out;
}

export async function sheetsBatchUpdate(
  accessToken: string,
  spreadsheetId: string,
  data: { range: string; values: (string | number)[][] }[],
): Promise<void> {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        valueInputOption: "USER_ENTERED",
        data: data.map((d) => ({ range: d.range, values: d.values })),
      }),
    },
  );
  if (!res.ok) throw new Error(`batchUpdate ${res.status}: ${await res.text()}`);
}
