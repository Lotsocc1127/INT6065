import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { buildGrowthSnapshot } from "@/lib/growth";
import { avg } from "@/lib/mastery";
import { prisma } from "@/lib/prisma";
import { hashShareToken } from "@/lib/share";
import { effectiveTierOf } from "@/lib/tier";

export const dynamic = "force-dynamic";

/**
 * GET /api/share/[token] —— 公开只读接口（无需登录）。
 * 只返回聚合成长档案，不含题干/作答/错因归因等敏感明细。
 */
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const tokenHash = hashShareToken(params.token);
    const link = await prisma.shareLink.findUnique({
      where: { tokenHash },
      include: { student: { include: { class: true } } },
    });
    if (!link || link.revoked) return ok({ error: "链接无效或已失效" }, 404);
    const student = link.student;
    if (!student.classId) return ok({ error: "学生不在任何班级" }, 404);

    // 最近查看时间（fire-and-forget，不阻塞响应）
    prisma.shareLink
      .update({ where: { id: link.id }, data: { lastViewedAt: new Date() } })
      .catch(() => {});

    const [subjects, goals, masteries] = await Promise.all([
      prisma.subject.findMany({ orderBy: { code: "asc" } }),
      prisma.learningGoal.findMany({
        where: { studentId: student.id },
        orderBy: { createdAt: "desc" },
      }),
      prisma.mastery.findMany({
        where: { studentId: student.id },
        select: { subjectId: true, kpId: true, value: true },
      }),
    ]);

    const masteryBySubject = new Map<string, Map<string, number>>();
    for (const m of masteries) {
      if (!masteryBySubject.has(m.subjectId)) masteryBySubject.set(m.subjectId, new Map());
      masteryBySubject.get(m.subjectId)!.set(m.kpId, m.value);
    }

    // 科目快照串行生成：共享 Neon Pooled 连接对并发查询敏感（曾报
    // Can't reach database server），科目数少，串行开销可忽略。
    const bySubject = [];
    for (const subject of subjects) {
      const snap = await buildGrowthSnapshot(student.id, subject.id);
      const map = masteryBySubject.get(subject.id) ?? new Map();
      const values = snap.kpList.map((k) => map.get(k.id) ?? 0);
      const tier = effectiveTierOf(avg(values), student.tierOverride);
      bySubject.push({
        subject: { code: subject.code, name: subject.name },
        tier,
        stats: snap.stats,
        trend: snap.trend,
        badges: snap.badges,
        radar: {
          indicators: snap.kpList.map((k) => ({ name: `${k.code} ${k.name}`, max: 1 })),
          values,
        },
      });
    }

    return ok({
      student: { name: student.name, studentNo: student.studentNo, className: student.class?.name ?? null },
      subjects: subjects.map((s) => ({ code: s.code, name: s.name })),
      goals: goals.map((g) => ({
        id: g.id,
        content: g.content,
        done: g.done,
        createdAt: g.createdAt,
      })),
      bySubject,
    });
  } catch (e) {
    return fail(e);
  }
}
