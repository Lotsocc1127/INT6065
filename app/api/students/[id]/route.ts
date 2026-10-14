import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { avg } from "@/lib/mastery";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** GET /api/students/:id —— 学生详情（教师端）：掌握度、历史、目标、错题与作答统计 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireApiUser(["TEACHER", "ADMIN"]);
    const student = await prisma.user.findUnique({
      where: { id: params.id },
      include: { class: true },
    });
    if (!student) return ok({ error: "学生不存在" }, 404);

    const masteries = await prisma.mastery.findMany({
      where: { studentId: student.id },
      include: { kp: true, history: { orderBy: { at: "asc" } } },
    });

    const bySubject = new Map<string, { code: string; name: string; items: typeof masteries }>();
    const subjects = await prisma.subject.findMany({
      where: { id: { in: [...new Set(masteries.map((m) => m.subjectId))] } },
    });
    for (const m of masteries) {
      const subj = subjects.find((s) => s.id === m.subjectId)!;
      if (!bySubject.has(m.subjectId)) {
        bySubject.set(m.subjectId, { code: subj.code, name: subj.name, items: [] });
      }
      bySubject.get(m.subjectId)!.items.push(m);
    }

    const [goals, wrongCount, submissions] = await Promise.all([
      prisma.learningGoal.findMany({ where: { studentId: student.id }, orderBy: { createdAt: "desc" } }),
      prisma.wrongQuestion.count({ where: { studentId: student.id, mastered: false } }),
      prisma.submission.findMany({
        where: { studentId: student.id },
        include: { answers: true, assignment: true },
        orderBy: { submittedAt: "desc" },
      }),
    ]);

    return ok({
      student: {
        id: student.id,
        name: student.name,
        className: student.class?.name ?? null,
        tierOverride: student.tierOverride,
      },
      mastery: [...bySubject.values()].map((g) => ({
        subject: { code: g.code, name: g.name },
        avg: avg(g.items.map((m) => m.value)),
        items: g.items.map((m) => ({
          kpId: m.kpId,
          kpCode: m.kp.code,
          kpName: m.kp.name,
          value: m.value,
          updatedAt: m.updatedAt,
          history: m.history.map((h) => ({ value: h.value, at: h.at })),
        })),
      })),
      goals: goals.map((g) => ({
        id: g.id,
        content: g.content,
        done: g.done,
        challenged: g.challenged,
        createdAt: g.createdAt,
      })),
      wrongCount,
      submissions: submissions.map((s) => ({
        id: s.id,
        assignmentTitle: s.assignment.title,
        submittedAt: s.submittedAt,
        avgScore: s.answers.length
          ? s.answers.reduce((a, b) => a + (b.score ?? 0), 0) / s.answers.length
          : null,
      })),
    });
  } catch (e) {
    return fail(e);
  }
}
