import { CHAM_CONG_TEMPLATE_TAB } from "./chamCongSheet";
import { num } from "./thuChiSheet";

export { CHAM_CONG_TEMPLATE_TAB };

/** Lương cơ bản tháng mặc định (VND) — quy đổi sang USD qua tỉ giá F2. */
export const DEFAULT_LUONG_CO_BAN_VND_THANG = 10_000_000;

/** Tỉ giá dự phòng (VND / 1 USD) khi ô F2 trống. */
export const DEFAULT_TY_GIA_VND_PER_USD = 25_500;

export type LuongNvConfig = {
  luongCoBanVndThang: number;
  tyGiaVndPerUsd: number;
  luongCoBanUsdThang: number;
  tyGiaSourceTab: string;
};

/** Tỉ giá từ ô F2 tab mẫu / nhân viên (Apps Script cập nhật). */
export function buildLuongNvConfig(tyGiaF2: number, sourceTab: string): LuongNvConfig {
  const luongCoBanVndThang = DEFAULT_LUONG_CO_BAN_VND_THANG;
  const tyGiaVndPerUsd = tyGiaF2 > 0 ? tyGiaF2 : DEFAULT_TY_GIA_VND_PER_USD;
  const luongCoBanUsdThang = luongCoBanVndThang / tyGiaVndPerUsd;
  return {
    luongCoBanVndThang,
    tyGiaVndPerUsd,
    luongCoBanUsdThang,
    tyGiaSourceTab: sourceTab,
  };
}

/** Đọc F2 từ batchGet (một ô). */
export function tyGiaFromF2Batch(rows: unknown[][], tabName: string): number {
  return num(rows?.[0]?.[0]);
}

export function calcBaseSalaryUsd(
  workingDays: number,
  daysInMonth: number,
  luongCoBanUsdThang: number,
): number {
  if (daysInMonth <= 0 || luongCoBanUsdThang <= 0) return 0;
  return (luongCoBanUsdThang / daysInMonth) * workingDays;
}
