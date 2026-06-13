const BALANCE_KEY = "opening_balance";

export type StoredBalance = {
  value: number;
  updatedAt: string;
};

export async function getOpeningBalance(kv: KVNamespace | undefined): Promise<number> {
  if (!kv) return 0;
  try {
    const raw = await kv.get(BALANCE_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as Partial<StoredBalance>;
    const v = parsed.value;
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

export async function setOpeningBalance(kv: KVNamespace | undefined, value: number): Promise<StoredBalance> {
  if (!kv) {
    throw new Error("BALANCE_KV chưa được bind trên Cloudflare Pages (Settings → Functions → KV).");
  }
  const stored: StoredBalance = { value, updatedAt: new Date().toISOString() };
  await kv.put(BALANCE_KEY, JSON.stringify(stored));
  return stored;
}
