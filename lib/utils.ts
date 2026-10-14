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

/** 选择题答案归一化为选项字母（A-D）。
 * 兼容 AI/人工输入的各种格式："C"、"C. -10"、"C、-10"、"-10"（选项文本）等；
 * 无法匹配到任何选项时原样返回。 */
export function resolveChoiceLetter(options: string[], answer: string): string {
  const a = answer.trim();
  if (!a) return a;
  const norm = (s: string) => s.trim().replace(/\s+/g, "").toLowerCase();
  const m = a.match(/^([A-Da-d])\s*[.、)）:：]?\s*(.*)$/);
  if (m) {
    const letter = m[1].toUpperCase();
    const rest = m[2].trim();
    if (!rest) return letter; // "C" / "C."
    const idx = letter.charCodeAt(0) - 65;
    if (options[idx] && norm(options[idx]) === norm(rest)) return letter;
    // 字母与其后内容不匹配时，继续按选项文本整体匹配
  }
  const idx = options.findIndex((o) => norm(o) === norm(a));
  return idx >= 0 ? String.fromCharCode(65 + idx) : a;
}

/** 选择题标准答案展示文案：优先 "C. 选项内容"；无法解析时回退原答案文本 */
export function choiceAnswerText(options: string[], answer: string): string {
  const letter = resolveChoiceLetter(options, answer);
  if (/^[A-D]$/.test(letter)) {
    const idx = letter.charCodeAt(0) - 65;
    return options[idx] ? `${letter}. ${options[idx]}` : letter;
  }
  return answer;
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
