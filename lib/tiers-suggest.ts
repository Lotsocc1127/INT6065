/**
 * 分层升降建议引擎：掌握度 + 近 7 天趋势 + 错因标签 → 候选名单。
 * 建议规则：自动分层（tierOf(avg)）与当前有效分层不一致时入选；
 * AI 理由由路由层补充，本文件提供模板兜底（buildTierAdviceFallback）。
 */
import { Role } from "@prisma/client";
import { prisma } from "./prisma";
import { avg, tierOf, TIER_META, type Tier } from "./mastery";
import { effectiveTierOf } from "./tier";
import { parseArr } from "./json";

const DAY = 24 * 60 * 60 * 1000;
const TIER_ORDER: Record<Tier, number> = { foundation: 0, intermediate: 1, advanced: 2 };

export interface TierCandidate {
  studentId: string;
  name: string;
  currentTier: Tier; // 有效分层（override ?? auto）
  autoTier: Tier;
  suggestedTier: Tier;
  direction: "up" | "down";
  pinned: boolean; // 当前有教师锁定
  avg: number;
  trendDelta: number | null; // 近 7 天首尾日桶差值；数据不足为 null
  weakKps: { code: string; name: string; avg: number }[];
  errorTags: { tag: string; count: number }[];
  advice: { summary: string; reasons: string[] };
}

type CandidateLite = Omit<TierCandidate, "advice">;

/** 模板兜底：用证据拼确定性中文建议（无需 LLM） */
export function buildTierAdviceFallback(c: CandidateLite): { summary: string; reasons: string[] } {
  const cur = TIER_META[c.currentTier].label;
  const next = TIER_META[c.suggestedTier].label;
  const verb = c.direction === "up" ? "提升" : "调整";
  const reasons: string[] = [
    `平均掌握度 ${Math.round(c.avg * 100)}%，自动分层为「${next}」`,
  ];
  if (c.trendDelta !== null)
    reasons.push(
      `近 7 天掌握度趋势 ${c.trendDelta >= 0 ? "上升" : "下降"} ${Math.abs(Math.round(c.trendDelta * 100))} 个百分点`
    );
  if (c.weakKps.length)
    reasons.push(`薄弱知识点：${c.weakKps.map((k) => `${k.code} ${k.name}`).join("、")}`);
  if (c.errorTags.length)
    reasons.push(`高频错因：${c.errorTags.map((t) => `${t.tag}(${t.count}次)`).join("、")}`);
  return {
    summary: `建议${verb}至「${next}」（当前「${cur}」）`,
    reasons,
  };
}

export async function suggestTierChanges(opts: {
  subjectId: string;
  classId: string;
}): Promise<TierCandidate[]> {
  const students = await prisma.user.findMany({
    where: { role: Role.STUDENT, classId: opts.classId },
    select: { id: true, name: true, tierOverride: true },
    orderBy: { name: "asc" },
  });
  if (!students.length) return [];

  const kps = await prisma.knowledgePoint.findMany({
    where: { subjectId: opts.subjectId },
    orderBy: { code: "asc" },
  });
  const masteries = await prisma.mastery.findMany({
    where: { subjectId: opts.subjectId, studentId: { in: students.map((s) => s.id) } },
    select: { studentId: true, kpId: true, value: true },
  });
  const valsByStudent = new Map<string, Map<string, number>>();
  for (const m of masteries) {
    if (!valsByStudent.has(m.studentId)) valsByStudent.set(m.studentId, new Map());
    valsByStudent.get(m.studentId)!.set(m.kpId, m.value);
  }

  // 每个学生的平均掌握度 / 自动分层 / 薄弱点
  const rows = students.map((s) => {
    const map = valsByStudent.get(s.id) ?? new Map();
    const values = kps.map((k) => map.get(k.id) ?? 0);
    const avgV = avg(values);
    const autoTier = tierOf(avgV);
    const currentTier = effectiveTierOf(avgV, s.tierOverride);
    const weakKps = kps
      .map((k, i) => ({ code: k.code, name: k.name, avg: values[i] }))
      .filter((k) => k.avg < 0.6)
      .sort((a, b) => a.avg - b.avg)
      .slice(0, 3);
    return {
      studentId: s.id,
      name: s.name,
      currentTier,
      autoTier,
      suggestedTier: autoTier,
      direction: (TIER_ORDER[autoTier] >= TIER_ORDER[currentTier] ? "up" : "down") as "up" | "down",
      pinned: s.tierOverride != null,
      avg: avgV,
      weakKps,
    };
  });
  // 仅自动分层与有效分层不一致时入选
  const cands = rows.filter((r) => r.autoTier !== r.currentTier);
  if (!cands.length) return [];
  const candIds = cands.map((c) => c.studentId);

  // 近 7 天趋势：按天桶取首尾差值
  const since = new Date(Date.now() - 7 * DAY);
  const points = await prisma.masteryPoint.findMany({
    where: {
      at: { gte: since },
      mastery: { subjectId: opts.subjectId, studentId: { in: candIds } },
    },
    select: { at: true, value: true, mastery: { select: { studentId: true } } },
    orderBy: { at: "asc" },
  });
  const trendByStudent = new Map<string, number | null>();
  const bucketsByStudent = new Map<string, Map<string, number[]>>();
  for (const p of points) {
    const sid = p.mastery.studentId;
    const d = new Date(p.at);
    const key = `${d.getMonth() + 1}/${d.getDate()}`;
    if (!bucketsByStudent.has(sid)) bucketsByStudent.set(sid, new Map());
    const buckets = bucketsByStudent.get(sid)!;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(p.value);
  }
  for (const [sid, buckets] of bucketsByStudent) {
    const days = [...buckets.keys()];
    trendByStudent.set(
      sid,
      days.length >= 2 ? avg(buckets.get(days.at(-1)!)!) - avg(buckets.get(days[0])!) : null
    );
  }

  // 高频错因（该生全部作答记录，Top3）
  const recs = await prisma.answerRecord.findMany({
    where: { studentId: { in: candIds }, question: { subjectId: opts.subjectId } },
    select: { studentId: true, errorTags: true },
  });
  const tagByStudent = new Map<string, Map<string, number>>();
  for (const r of recs) {
    if (!tagByStudent.has(r.studentId)) tagByStudent.set(r.studentId, new Map());
    const m = tagByStudent.get(r.studentId)!;
    for (const t of parseArr(r.errorTags)) m.set(t, (m.get(t) ?? 0) + 1);
  }

  return cands.map((c) => {
    const lite: CandidateLite = {
      ...c,
      trendDelta: trendByStudent.get(c.studentId) ?? null,
      errorTags: [...(tagByStudent.get(c.studentId) ?? new Map()).entries()]
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 3),
    };
    return { ...lite, advice: buildTierAdviceFallback(lite) };
  });
}
