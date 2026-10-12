/** 数据层把数组字段存为 JSON 字符串，这里统一解析/序列化 */

export function parseArr<T = string>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

export function toArrStr(arr: unknown[] | null | undefined): string {
  return JSON.stringify(arr ?? []);
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** 容错 JSON 解析：抽取文本中首个完整 {...} 块 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  // 去掉可能的 markdown 代码围栏
  const fences = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(fences);
  } catch {
    // 抽取首个平衡的 {...} 块
    const start = fences.indexOf("{");
    if (start === -1) throw new Error("LLM 未返回 JSON: " + text.slice(0, 200));
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < fences.length; i++) {
      const c = fences[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
      } else {
        if (c === '"') inStr = true;
        else if (c === "{") depth++;
        else if (c === "}") {
          depth--;
          if (depth === 0) {
            const block = fences.slice(start, i + 1);
            try {
              return JSON.parse(block);
            } catch {
              throw new Error("LLM 返回的 JSON 无法解析: " + block.slice(0, 200));
            }
          }
        }
      }
    }
    throw new Error("LLM 返回内容中未找到完整 JSON: " + text.slice(0, 200));
  }
}
