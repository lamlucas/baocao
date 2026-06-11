import type { Env } from "./env";
import { runLuongNvMonthlyBot } from "./lib/luongNvMonthlyBot";

/** 15:00 GMT+7 ngày 1 hàng tháng — gửi bảng lương tháng trước vào nhóm Nội Bộ. */
export const onScheduled: PagesFunction<Env> = async (context) => {
  const { env } = context;
  try {
    const result = await runLuongNvMonthlyBot(env);
    console.log("[scheduled] luongNvMonthlyBot", result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[scheduled] luongNvMonthlyBot error:", msg);
  }
};
