/**
 * 班级学情周报聚合：近 7 天 vs 前 7 天（提交率 / 正确率 / 薄弱点 / 趋势 / 错因 / 关注学生 / 分层分布）。
 * 演示数据（source="demo"）包含在内，与看板、备课口径一致。
 */
import { Role } from "@prisma/client";
import { prisma } from "./prisma";
import { avg, type Tier } from "./mastery";
import { effectiveTierOf } from "./tier";
import { parseArr } from "./json";
import { pct } from "./utils";

const DAY = 24 * 60 * 60 * 1000;

export interface WeeklyStats {
  subjectName: string;
  className: string;
  studentCount: number;
  range: { current: { from: string; to: string }; previous: { from: string; to: string } };
  assignmentCount: { current: number; previous: number };
  submissionRate: { current: number | null; previous: number | null }; // 0-1；窗口无作业为 null
  correctRate: { current: number | null; previous: number | null }; // 0-1；窗口无已批改作答为 null
  weakKps: { code: string; name: string; classAvg: number }[];
  masteryTrend: { date: string; avg: number }[]; // 两窗 14 天按天桶
  trendDelta: number; // 14 天首尾桶差值
  errorTags: { tag: string; count: number }[]; // 当前窗
  attentionStudents: {
    id: string;
    name: string;
    avg: number;
    trendDelta: number | null; // 近 7 天
    reasons: string[];
  }[];
  tierDistribution: Record<Tier, number>;
}

function dayKey(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export async function aggregateWeeklyReport(opts: {
  subjectId: string;
  className: string;
  subjectName: string;
  classId: string;
}): Promise<WeeklyStats> {
  const now = Date.now();
  const curFrom = new Date(now - 7 * DAY);
  const prevFrom = new Date(now - 14 * DAY);

  const students = await prisma.user.findMany({
    where: { role: Role.STUDENT, classId: opts.classId },
    select: { id: true, name: true, tierOverride: true },
    orderBy: { name: "asc" },
  });
  const studentIds = students.map((s) => s.id);

  const kps = await prisma.knowledgePoint.findMany({
    where: { subjectId: opts.subjectId },
    orderBy: { code: "asc" },
  });
  const masteries = await prisma.mastery.findMany({
    where: { subjectId: opts.subjectId, studentId: { in: studentIds } },
    select: { studentId: true, kpId: true, value: true },
  });
  const valsByStudent = new Map<string, Map<string, number>>();
  for (const m of masteries) {
    if (!valsByStudent.has(m.studentId)) valsByStudent.set(m.studentId, new Map());
    valsByStudent.get(m.studentId)!.set(m.kpId, m.value);
  }

  // 各知识点班级平均 + 薄弱点（与看板同口径：< 0.6）
  const studentRows = students.map((s) => {
    const map = valsByStudent.get(s.id) ?? new Map();
    const values = kps.map((k) => map.get(k.id) ?? 0);
    const avgV = avg(values);
    return { id: s.id, name: s.name, avg: avgV, values, tier: effectiveTierOf(avgV, s.tierOverride) };
  });
  const kpClassAvg = kps.map((k, i) => avg(studentRows.map((r) => r.values[i])));
  const weakKps = kps
    .map((k, i) => ({ code: k.code, name: k.name, classAvg: kpClassAvg[i] }))
    .filter((k) => k.classAvg < 0.6);

  // 两窗作业数与提交数（按提交时间切窗）
  const [curAssignments, prevAssignments, curSubs, prevSubs] = await Promise.all([
    prisma.assignment.count({
      where: { subjectId: opts.subjectId, classId: opts.classId, createdAt: { gte: curFrom } },
    }),
    prisma.assignment.count({
      where: {
        subjectId: opts.subjectId,
        classId: opts.classId,
        createdAt: { gte: prevFrom, lt: curFrom },
      },
    }),
    prisma.submission.count({
      where: {
        submittedAt: { gte: curFrom },
        assignment: { subjectId: opts.subjectId, classId: opts.classId },
      },
    }),
    prisma.submission.count({
      where: {
        submittedAt: { gte: prevFrom, lt: curFrom },
        assignment: { subjectId: opts.subjectId, classId: opts.classId },
      },
    }),
  ]);
  const rate = (subs: number, asgs: number) =>
    asgs > 0 && students.length > 0 ? subs / (asgs * students.length) : null;

  // 两窗正确率（已批改作答的 score 均值）
  const [curScores, prevScores] = await Promise.all([
    prisma.answerRecord.findMany({
      where: {
        score: { not: null },
        submission: { submittedAt: { gte: curFrom }, assignment: { subjectId: opts.subjectId, classId: opts.classId } },
      },
      select: { score: true },
    }),
    prisma.answerRecord.findMany({
      where: {
        score: { not: null },
        submission: { submittedAt: { gte: prevFrom, lt: curFrom }, assignment: { subjectId: opts.subjectId, classId: opts.classId } },
      },
      select: { score: true },
    }),
  ]);
  const correctRate = (rows: { score: number | null }[]) =>
    rows.length ? avg(rows.map((r) => r.score ?? 0)) : null;

  // 两窗 14 天掌握度趋势（按天桶）+ 每人近 7 天趋势
  const points = await prisma.masteryPoint.findMany({
    where: { at: { gte: prevFrom }, mastery: { subjectId: opts.subjectId, studentId: { in: studentIds } } },
    select: { at: true, value: true, mastery: { select: { studentId: true } } },
    orderBy: { at: "asc" },
  });
  const dayBuckets = new Map<string, number[]>();
  const perStudent = new Map<string, Map<string, number[]>>();
  for (const p of points) {
    const key = dayKey(new Date(p.at));
    if (!dayBuckets.has(key)) dayBuckets.set(key, []);
    dayBuckets.get(key)!.push(p.value);

    const sid = p.mastery.studentId;
    const inCurrent = p.at >= curFrom;
    if (inCurrent) {
      if (!perStudent.has(sid)) perStudent.set(sid, new Map());
      const m = perStudent.get(sid)!;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(p.value);
    }
  }
  const masteryTrend = [...dayBuckets.entries()].map(([date, vals]) => ({ date, avg: avg(vals) }));
  const trendDelta = masteryTrend.length
    ? masteryTrend.at(-1)!.avg - masteryTrend[0].avg
    : 0;
  const trendByStudent = new Map<string, number | null>();
  for (const [sid, buckets] of perStudent) {
    const days = [...buckets.keys()];
    trendByStudent.set(
      sid,
      days.length >= 2 ? avg(buckets.get(days.at(-1)!)!) - avg(buckets.get(days[0])!) : null
    );
  }

  // 当前窗高频错因
  const recs = await prisma.answerRecord.findMany({
    where: {
      submission: { submittedAt: { gte: curFrom }, assignment: { subjectId: opts.subjectId, classId: opts.classId } },
    },
    select: { errorTags: true },
  });
  const tagCount = new Map<string, number>();
  for (const r of recs) for (const t of parseArr(r.errorTags)) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
  const errorTags = [...tagCount.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  // 待关注学生：平均掌握度低（<0.6）或近 7 天明显下滑（<-0.05），最多 3 人
  const attentionStudents = studentRows
    .map((r) => {
      const td = trendByStudent.get(r.id) ?? null;
      const reasons: string[] = [];
      if (r.avg < 0.6) reasons.push(`平均掌握度 ${pct(r.avg)}（低于 60%）`);
      if (td !== null && td < -0.05) reasons.push(`近 7 天下滑 ${pct(-td)}`);
      const weak = kps
        .map((k, i) => ({ code: k.code, name: k.name, v: r.values[i] }))
        .filter((k) => k.v < 0.6)
        .slice(0, 3);
      if (weak.length) reasons.push(`薄弱：${weak.map((k) => `${k.code} ${k.name}`).join("、")}`);
      return { id: r.id, name: r.name, avg: r.avg, trendDelta: td, reasons };
    })
    .filter((r) => r.reasons.length > 0)
    .sort((a, b) => a.avg - b.avg)
    .slice(0, 3);

  const tierDistribution: Record<Tier, number> = { foundation: 0, intermediate: 0, advanced: 0 };
  for (const r of studentRows) tierDistribution[r.tier]++;

  return {
    subjectName: opts.subjectName,
    className: opts.className,
    studentCount: students.length,
    range: {
      current: { from: curFrom.toISOString(), to: new Date(now).toISOString() },
      previous: { from: prevFrom.toISOString(), to: curFrom.toISOString() },
    },
    assignmentCount: { current: curAssignments, previous: prevAssignments },
    submissionRate: { current: rate(curSubs, curAssignments), previous: rate(prevSubs, prevAssignments) },
    correctRate: { current: correctRate(curScores), previous: correctRate(prevScores) },
    weakKps,
    masteryTrend,
    trendDelta,
    errorTags,
    attentionStudents,
    tierDistribution,
  };
}

function fmtRange(from: string, to: string): string {
  const f = new Date(from);
  const t = new Date(to);
  return `${f.getMonth() + 1}/${f.getDate()}–${t.getMonth() + 1}/${t.getDate()}`;
}

/** 模板兜底周报（无需 LLM） */
export function buildReportFallback(stats: WeeklyStats): {
  title: string;
  summary: string;
  suggestions: string[];
} {
  const cur = fmtRange(stats.range.current.from, stats.range.current.to);
  const prev = fmtRange(stats.range.previous.from, stats.range.previous.to);
  const rateTxt = (r: number | null) => (r === null ? "无数据" : `${Math.round(r * 100)}%`);
  const correctTxt = (r: number | null) => (r === null ? "无数据" : `${Math.round(r * 100)}%`);

  const lastAvg = stats.masteryTrend.length ? stats.masteryTrend.at(-1)!.avg : null;
  const parts: string[] = [
    `本周期（${cur}）${stats.className} 共 ${stats.studentCount} 名学生`,
  ];
  if (stats.assignmentCount.current > 0)
    parts.push(`布置作业 ${stats.assignmentCount.current} 份，提交率 ${rateTxt(stats.submissionRate.current)}（上期 ${prev} 为 ${rateTxt(stats.submissionRate.previous)}）`);
  if (stats.correctRate.current !== null)
    parts.push(`平均正确率 ${correctTxt(stats.correctRate.current)}（上期 ${correctTxt(stats.correctRate.previous)}）`);
  if (lastAvg !== null)
    parts.push(
      `班级平均掌握度 ${pct(lastAvg)}，两周趋势${stats.trendDelta >= 0 ? "上升" : "下降"} ${pct(Math.abs(stats.trendDelta))}`
    );

  const summary = parts.join("；") + "。";

  const suggestions: string[] = [];
  if (stats.weakKps.length)
    suggestions.push(
      `针对薄弱知识点「${stats.weakKps.map((k) => `${k.code} ${k.name}`).join("、")}」安排讲评与分层练习。`
    );
  if (stats.submissionRate.current !== null && stats.submissionRate.current < 0.8)
    suggestions.push("提交率低于 80%，请提醒未提交学生按时完成作业。");
  if (stats.attentionStudents.length)
    suggestions.push(
      `对 ${stats.attentionStudents.map((s) => s.name).join("、")} 进行个别辅导，结合错因面批。`
    );
  if (stats.errorTags.length)
    suggestions.push(
      `高频错因「${stats.errorTags.slice(0, 3).map((t) => t.tag).join("、")}」可在课堂集中纠错。`
    );
  if (!suggestions.length) suggestions.push("整体情况平稳，建议保持当前节奏并巩固已掌握知识点。");

  return {
    title: `${stats.subjectName} · ${stats.className} 学情周报（${cur}）`,
    summary,
    suggestions,
  };
}
