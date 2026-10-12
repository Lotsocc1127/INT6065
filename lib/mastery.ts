/**
 * 核心算法（开发文档第 6 节）：
 * 6.1 掌握度更新（简化 BKT 加权）· 6.3 分层判定 · 6.4 个性化学习路径（拓扑补前置）
 */
import { clamp } from "./json";

/** 旧:新 = 6:4 加权融合，避免单次波动剧烈，同时反映近期表现 */
export function updateMastery(prev: number, correctRate: number, alpha = 0.4): number {
  const next = prev * (1 - alpha) + correctRate * alpha;
  return clamp(next, 0, 1);
}

export type Tier = "foundation" | "intermediate" | "advanced";

/** 分层判定：<0.5 基础巩固 / <0.8 能力提升 / 拓展探究 */
export function tierOf(mastery: number): Tier {
  if (mastery < 0.5) return "foundation";
  if (mastery < 0.8) return "intermediate";
  return "advanced";
}

export const TIER_META: Record<
  Tier,
  { label: string; short: string; desc: string; requirement: string }
> = {
  foundation: {
    label: "基础巩固",
    short: "基础",
    desc: "先补前置、重建信心，聚焦概念理解与基本计算。",
    requirement: "概念理解与基本计算",
  },
  intermediate: {
    label: "能力提升",
    short: "提升",
    desc: "在掌握核心方法的基础上，训练综合运用。",
    requirement: "含括号/分母的综合解方程（或对应学科的综合运用）",
  },
  advanced: {
    label: "拓展探究",
    short: "拓展",
    desc: "挑战复杂实际问题建模与开放探究，深度学习。",
    requirement: "复杂实际问题建模与开放探究",
  },
};

export interface KpNode {
  id: string;
  prereqIds: string[];
}

/**
 * 个性化学习路径：对未掌握知识点按拓扑序输出，前置知识点排在前面（递归补前置）。
 * 掌握阈值 0.8 视为已掌握（与分层判定一致）。
 */
export function buildPath(
  kps: KpNode[],
  masteryMap: Map<string, number>,
  masteredThreshold = 0.8
): KpNode[] {
  const byId = new Map(kps.map((k) => [k.id, k]));
  const unmastered = kps.filter((k) => (masteryMap.get(k.id) ?? 0) < masteredThreshold);

  // 收集需要补齐的闭包：未掌握点及其未掌握的前置（递归）
  const needed = new Set<string>();
  const visit = (id: string) => {
    if (needed.has(id)) return;
    needed.add(id);
    const kp = byId.get(id);
    if (!kp) return;
    for (const p of kp.prereqIds) visit(p);
  };
  for (const k of unmastered) visit(k.id);

  // Kahn 拓扑排序（前置在前）
  const nodes = [...needed].map((id) => byId.get(id)!).filter(Boolean);
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    indeg.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const n of nodes) {
    for (const p of n.prereqIds) {
      if (needed.has(p)) {
        adj.get(p)!.push(n.id);
        indeg.set(n.id, (indeg.get(n.id) ?? 0) + 1);
      }
    }
  }
  const queue = nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  const ordered: KpNode[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    ordered.push(byId.get(id)!);
    for (const next of adj.get(id)!) {
      const d = (indeg.get(next) ?? 1) - 1;
      indeg.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  return ordered;
}

/** 平均值 */
export function avg(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
