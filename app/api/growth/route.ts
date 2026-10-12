import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { avg } from "@/lib/mastery";
import { prisma } from "@/lib/prisma";

/** GET /api/growth?subject= —— 成长档案：统计、掌握度趋势、徽章 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireApiUser(["STUDENT"]);
    const subjectCode = req.nextUrl.searchParams.get("subject") ?? "math";
    const subject = await prisma.subject.findUnique({ where: { code: subjectCode } });
    if (!subject) return ok({ error: "科目不存在" }, 404);

    const [submissions, wrongTotal, wrongMastered, points, kps] = await Promise.all([
      prisma.submission.findMany({
        where: { studentId: session.user.id, assignment: { subjectId: subject.id } },
        include: { answers: true },
      }),
      prisma.wrongQuestion.count({
        where: { studentId: session.user.id, question: { subjectId: subject.id } },
      }),
      prisma.wrongQuestion.count({
        where: { studentId: session.user.id, mastered: true, question: { subjectId: subject.id } },
      }),
      prisma.masteryPoint.findMany({
        where: { mastery: { studentId: session.user.id, subjectId: subject.id } },
        include: { mastery: { include: { kp: true } } },
        orderBy: { at: "asc" },
      }),
      prisma.knowledgePoint.findMany({ where: { subjectId: subject.id } }),
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

    return ok({
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
    });
  } catch (e) {
    return fail(e);
  }
}
