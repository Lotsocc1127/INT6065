import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 0-1 掌握度 → 百分比文案 */
export function pct(v: number | null | undefined, digits = 0): string {
  if (v == null || Number.isNaN(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

/** 掌握度数值配色（柔和不刺眼）：绿=达标 ≥80%，蓝=进阶中 ≥50%，琥珀=待提升 */
export function masteryTextColor(v: number): string {
  if (v >= 0.8) return "text-emerald-600";
  if (v >= 0.5) return "text-blue-600";
  return "text-amber-600";
}

/** 毫秒 → 可读用时 */
export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 60_000) return `${Math.round(ms / 1000)} 秒`;
  return `${Math.floor(ms / 60_000)} 分 ${Math.round((ms % 60_000) / 1000)} 秒`;
}

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${fmtDate(date)} ${hh}:${mm}`;
}
