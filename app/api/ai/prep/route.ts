import { NextRequest } from "next/server";
import { Role } from "@prisma/client";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { llmJson } from "@/lib/llm";
import { avg, TIER_META, type Tier } from "@/lib/mastery";
import { effectiveTierOf } from "@/lib/tier";
import { parseArr } from "@/lib/json";
import { PREP_SYSTEM, prepContext } from "@/lib/prompts";
import { prisma } from "@/lib/prisma";
import { formatStudent } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** POST /api/ai/prep —— AI 备课助手（7.7）：结合班级学情生成可编辑教案
 * {subjectCode, classId?, kpCodes?, lessons?, requirement?} */
export async function POST(req: NextRequest) {
  try {
    await requireApiUser(["TEACHER", "ADMIN"]);
    const body = await req.json();
    const subjectCode = String(body?.subjectCode ?? "math");
    const kpCodes: string[] = Array.isArray(body?.kpCodes) ? body.kpCodes : [];
    const lessons = Math.min(8, Math.max(1, Number(body?.lessons) || 1));
    const requirement = String(body?.requirement ?? "").slice(0, 500);

    const subject = await prisma.subject.findUnique({ where: { code: subjectCode } });
    if (!subject) return ok({ error: "科目不存在" }, 404);

    const classes = await prisma.class.findMany({ orderBy: { name: "asc" } });
    const cls = body?.classId
      ? classes.find((c) => c.id === String(body.classId))
      : classes[0];
    if (!cls) return ok({ error: "没有班级数据" }, 404);

    const kps = await prisma.knowledgePoint.findMany({
      where: {
        subjectId: subject.id,
        ...(kpCodes.length ? { code: { in: kpCodes } } : {}),
      },
      orderBy: { code: "asc" },
    });
    if (!kps.length) return ok({ error: "没有可选知识点" }, 400);

    // ---------- 学情数据（复用看板聚合逻辑） ----------
    const students = await prisma.user.findMany({
      where: { role: Role.STUDENT, classId: cls.id },
      select: { id: true, name: true, studentNo: true, tierOverride: true },
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

    const studentRows = students.map((s) => {
      const map = masteryByStudent.get(s.id) ?? new Map();
      const values = kps.map((k) => map.get(k.id) ?? 0);
      return {
        name: s.name,
        studentNo: s.studentNo,
        values,
        avg: avg(values),
        tier: effectiveTierOf(avg(values), s.tierOverride),
      };
    });
    const kpClassAvg = kps.map((k, i) => avg(studentRows.map((r) => r.values[i])));
    const weakKps = kps
      .map((k, i) => ({ code: k.code, name: k.name, classAvg: kpClassAvg[i] }))
      .filter((k) => k.classAvg < 0.6);

    const tierGroups: Record<Tier, string[]> = { foundation: [], intermediate: [], advanced: [] };
    for (const r of studentRows) tierGroups[r.tier].push(formatStudent(r.name, r.studentNo));
    const tiers = (Object.keys(tierGroups) as Tier[]).map((t) => ({
      label: TIER_META[t].label,
      count: tierGroups[t].length,
      names: tierGroups[t],
    }));

    const assignments = await prisma.assignment.findMany({
      where: { subjectId: subject.id, classId: cls.id },
      include: { _count: { select: { submissions: true } } },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    const stats = {
      assignmentCount: assignments.length,
      submissionRate: assignments.length
        ? Math.round(avg(assignments.map((a) => a._count.submissions / students.length)) * 100)
        : 0,
      recentTitles: assignments.slice(0, 3).map((a) => a.title),
    };

    // 全班高频错误标签（AnswerRecord.errorTags 为 JSON 字符串，经题目关系过滤科目）
    const records = await prisma.answerRecord.findMany({
      where: { studentId: { in: students.map((s) => s.id) }, question: { subjectId: subject.id } },
      select: { errorTags: true },
    });
    const tagCount = new Map<string, number>();
    for (const r of records) {
      for (const t of parseArr(r.errorTags)) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
    }
    const commonErrorTags = [...tagCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tag, count]) => ({ tag, count }));

    // ---------- 生成教案 ----------
    const result = await llmJson<{
      title: string;
      targets: string[];
      keyPoints: string[];
      difficulties: string[];
      flow: { stage: string; duration: number; intent: string; content: string }[];
      pedagogy: { theory: string; application: string }[];
      boardDesign: string;
      homework: string;
      preview: string;
    }>(
      [
        { role: "system", content: PREP_SYSTEM },
        {
          role: "user",
          content: prepContext({
            subjectName: subject.name,
            className: cls.name,
            studentCount: students.length,
            kps: kps.map((k, i) => ({ code: k.code, name: k.name, classAvg: kpClassAvg[i] })),
            weakKps,
            tiers,
            stats,
            commonErrorTags,
            lessons,
            requirement,
          }),
        },
      ],
      { maxTokens: 8192, task: "prep" }
    );

    // ---------- 输出消毒 ----------
    const str = (v: unknown, fb = "") => (typeof v === "string" ? v : fb);
    const strArr = (v: unknown) =>
      Array.isArray(v) ? v.map((x) => String(x)).slice(0, 12) : [];
    const flow = (Array.isArray(result?.flow) ? result.flow : []).slice(0, 12)
      .map((f, i) => ({
        stage: str(f?.stage, `环节 ${i + 1}`),
        duration: Math.min(45, Math.max(1, Math.round(Number(f?.duration) || 5))),
        intent: str(f?.intent),
        content: str(f?.content),
      }))
      .filter((f) => f.content);
    const pedagogy = (Array.isArray(result?.pedagogy) ? result.pedagogy : []).slice(0, 6)
      .map((p) => ({ theory: str(p?.theory), application: str(p?.application) }))
      .filter((p) => p.theory && p.application);

    const prep = {
      title: str(result?.title, `${subject.name}教案`),
      targets: strArr(result?.targets),
      keyPoints: strArr(result?.keyPoints),
      difficulties: strArr(result?.difficulties),
      flow,
      pedagogy,
      boardDesign: str(result?.boardDesign),
      homework: str(result?.homework),
      preview: str(result?.preview),
    };
    if (!flow.length) return ok({ error: "AI 未生成有效教案" }, 502);

    return ok({ prep });
  } catch (e) {
    return fail(e);
  }
}
