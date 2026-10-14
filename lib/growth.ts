/**
 * 成长档案聚合（学生端 /api/growth 与家长分享页共用）：
 * 统计、按天掌握度趋势、各知识点轨迹、徽章。只含聚合数据，不含题干/作答/归因。
 */
import { prisma } from "./prisma";
import { avg } from "./mastery";

export interface GrowthSnapshot {
  stats: {
    submissions: number;
    totalTimeMs: number;
    wrongTotal: number;
    wrongMastered: number;
    avgScore: number | null;
  };
  trend: { date: string; avg: number }[];
  kpTrend: { code: string; name: string; series: { at: string; value: number }[] }[];
  kpList: { id: string; code: string; name: string }[];
  badges: { name: string; desc: string; earned: boolean }[];
}

export async function buildGrowthSnapshot(
  studentId: string,
  subjectId: string
): Promise<GrowthSnapshot> {
  const [submissions, wrongTotal, wrongMastered, points, kps] = await Promise.all([
    prisma.submission.findMany({
      where: { studentId, assignment: { subjectId } },
      include: { answers: true },
    }),
    prisma.wrongQuestion.count({
      where: { studentId, question: { subjectId } },
    }),
    prisma.wrongQuestion.count({
      where: { studentId, mastered: true, question: { subjectId } },
    }),
    prisma.masteryPoint.findMany({
      where: { mastery: { studentId, subjectId } },
      include: { mastery: { include: { kp: true } } },
      orderBy: { at: "asc" },
    }),
    prisma.knowledgePoint.findMany({ where: { subjectId } }),
  ]);

  const totalTimeMs = submissions
    .flatMap((s) => s.answers)
    .reduce((acc, a) => acc + (a.timeSpentMs ?? 0), 0);

  // 按天聚合平均掌握度
  const dayBuckets = new Map<string, number[]>();
  for (const p of points) {
    const d = new Date(p.at);
    const key = `${d.getMonth() + 1}/${d.getDate()}`;
    if (!dayBuckets.has(key)) dayBuckets.set(key, []);
    dayBuckets.get(key)!.push(p.value);
  }
  const trend = [...dayBuckets.entries()].map(([date, vals]) => ({ date, avg: avg(vals) }));

  // 每个知识点的轨迹
  const kpPoints = new Map<string, { code: string; name: string; series: { at: string; value: number }[] }>();
  for (const p of points) {
    const kp = p.mastery.kp;
    if (!kpPoints.has(kp.id)) kpPoints.set(kp.id, { code: kp.code, name: kp.name, series: [] });
    kpPoints.get(kp.id)!.series.push({ at: p.at.toISOString(), value: p.value });
  }

  // 徽章（形成性反馈，非排名）
  const firstAvg = avg([...dayBuckets.values()][0] ?? []);
  const lastAvg = avg([...dayBuckets.values()].at(-1) ?? []);
  const fullScore = submissions.some(
    (s) => s.answers.length > 0 && s.answers.every((a) => a.score === 1)
  );
  const badges = [
    { name: "坚持之星", desc: "提交作业满 3 次", earned: submissions.length >= 3 },
    { name: "进步之星", desc: "掌握度提升超过 10 个百分点", earned: lastAvg - firstAvg >= 0.1 },
    { name: "攻克之星", desc: "攻克错题满 2 道", earned: wrongMastered >= 2 },
    { name: "满分之星", desc: "至少一次作业全对", earned: fullScore },
  ];

  return {
    stats: {
      submissions: submissions.length,
      totalTimeMs,
      wrongTotal,
      wrongMastered,
      avgScore: submissions.length
        ? avg(
            submissions
              .filter((s) => s.answers.some((a) => a.score != null))
              .map((s) => avg(s.answers.map((a) => a.score ?? 0)))
          )
        : null,
    },
    trend,
    kpTrend: [...kpPoints.values()],
    kpList: kps.map((k) => ({ id: k.id, code: k.code, name: k.name })),
    badges,
  };
}
