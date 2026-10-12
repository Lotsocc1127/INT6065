import { NextRequest } from "next/server";
import type { Prisma, QuestionType } from "@prisma/client";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { parseArr } from "@/lib/json";
import { prisma } from "@/lib/prisma";

/** GET /api/questions?subject=&kp=&difficulty=&type=&q= —— 题库浏览（教师端，含答案） */
export async function GET(req: NextRequest) {
  try {
    const session = await requireApiUser(["TEACHER", "ADMIN"]);
    void session;
    const sp = req.nextUrl.searchParams;
    const where: Prisma.QuestionWhereInput = {};
    const subjectCode = sp.get("subject");
    if (subjectCode) {
      const subject = await prisma.subject.findUnique({ where: { code: subjectCode } });
      if (subject) where.subjectId = subject.id;
    }
    const kpId = sp.get("kp");
    if (kpId) where.kpIds = { contains: `"${kpId}"` };
    const difficulty = Number(sp.get("difficulty"));
    if (difficulty) where.difficulty = difficulty;
    const type = sp.get("type") as QuestionType | null;
    if (type) where.type = type;
    const q = sp.get("q");
    if (q) where.stem = { contains: q };

    const questions = await prisma.question.findMany({
      where,
      orderBy: [{ difficulty: "asc" }, { stem: "asc" }],
      include: { subject: true },
      take: 200,
    });
    const kpIds = [...new Set(questions.flatMap((q) => parseArr(q.kpIds)))];
    const kps = await prisma.knowledgePoint.findMany({ where: { id: { in: kpIds } } });
    const kpById = new Map(kps.map((k) => [k.id, k]));

    return ok(
      questions.map((q) => ({
        id: q.id,
        subjectCode: q.subject.code,
        kpIds: parseArr(q.kpIds),
        kpCodes: parseArr(q.kpIds)
          .map((id) => kpById.get(id)?.code)
          .filter(Boolean),
        type: q.type,
        difficulty: q.difficulty,
        stem: q.stem,
        options: parseArr<string>(q.options),
        answer: q.answer,
        analysis: q.analysis,
      }))
    );
  } catch (e) {
    return fail(e);
  }
}
