import { NextRequest } from "next/server";
import { Role } from "@prisma/client";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { avg, tierOf, type Tier } from "@/lib/mastery";
import { prisma } from "@/lib/prisma";

/** GET /api/teacher/dashboard?subject=&classId= —— 班级看板：聚合掌握度、热力图矩阵、分层诊断 */
export async function GET(req: NextRequest) {
  try {
    await requireApiUser(["TEACHER", "ADMIN"]);
    const sp = req.nextUrl.searchParams;
    const subjectCode = sp.get("subject") ?? "math";
    const subject = await prisma.subject.findUnique({ where: { code: subjectCode } });
    if (!subject) return ok({ error: "科目不存在" }, 404);

    const classes = await prisma.class.findMany({ orderBy: { name: "asc" } });
    const cls = sp.get("classId")
      ? classes.find((c) => c.id === sp.get("classId"))
      : classes[0];
    if (!cls) return ok({ error: "没有班级数据" }, 404);

    const kps = await prisma.knowledgePoint.findMany({
      where: { subjectId: subject.id },
      orderBy: { code: "asc" },
    });
    const students = await prisma.user.findMany({
      where: { role: Role.STUDENT, classId: cls.id },
      orderBy: { name: "asc" },
    });

    const masteries = await prisma.mastery.findMany({
      where: { subjectId: subject.id, studentId: { in: students.map((s) => s.id) } },
    });
    const masteryByStudent = new Map<string, Map<string, number>>();
    for (const m of masteries) {
      if (!masteryByStudent.has(m.studentId)) masteryByStudent.set(m.studentId, new Map());
      masteryByStudent.get(m.studentId)!.set(m.kpId, m.value);
    }

    // 学生平均掌握度 + 分层
    const studentRows = students.map((s) => {
      const map = masteryByStudent.get(s.id) ?? new Map();
      const values = kps.map((k) => map.get(k.id) ?? 0);
      const avgV = avg(values);
      return {
        id: s.id,
        name: s.name,
        avg: avgV,
        tier: tierOf(avgV),
        values,
      };
    });

    const kpClassAvg = kps.map((k, i) => avg(studentRows.map((r) => r.values[i])));
    const tiers: Record<Tier, string[]> = { foundation: [], intermediate: [], advanced: [] };
    for (const r of studentRows) tiers[r.tier].push(r.name);

    const assignments = await prisma.assignment.findMany({
      where: { subjectId: subject.id, classId: cls.id },
      include: { _count: { select: { submissions: true } } },
    });
    const submissionRate = assignments.length
      ? avg(assignments.map((a) => a._count.submissions / students.length))
      : 0;

    return ok({
      subject: { code: subject.code, name: subject.name },
      class: { id: cls.id, name: cls.name },
      classes: classes.map((c) => ({ id: c.id, name: c.name })),
      kps: kps.map((k, i) => ({ id: k.id, code: k.code, name: k.name, classAvg: kpClassAvg[i] })),
      students: studentRows.map((r) => ({
        id: r.id,
        name: r.name,
        avg: r.avg,
        tier: r.tier,
        values: Object.fromEntries(kps.map((k, i) => [k.id, r.values[i]])),
      })),
      tiers,
      stats: {
        classAvg: avg(studentRows.map((r) => r.avg)),
        proficient: studentRows.filter((r) => r.avg >= 0.8).length,
        weakKpCodes: kps.filter((_, i) => kpClassAvg[i] < 0.6).map((k) => k.code),
        assignmentCount: assignments.length,
        submissionRate: Math.round(submissionRate * 100),
      },
    });
  } catch (e) {
    return fail(e);
  }
}
