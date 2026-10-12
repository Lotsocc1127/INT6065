import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { parseArr } from "@/lib/json";
import { prisma } from "@/lib/prisma";

/** GET /api/wrong-questions?subject= —— 错题本（含归因与最近一次作答） */
export async function GET(req: NextRequest) {
  try {
    const session = await requireApiUser(["STUDENT"]);
    const subjectCode = req.nextUrl.searchParams.get("subject");
    const subject = subjectCode ? await prisma.subject.findUnique({ where: { code: subjectCode } }) : null;

    const wqs = await prisma.wrongQuestion.findMany({
      where: {
        studentId: session.user.id,
        ...(subject ? { question: { subjectId: subject.id } } : {}),
      },
      orderBy: { lastWrongAt: "desc" },
      include: { question: true },
    });

    const questionIds = wqs.map((w) => w.questionId);
    const kpIds = [...new Set(wqs.flatMap((w) => parseArr(w.kpIds)))];
    const [kps, records] = await Promise.all([
      prisma.knowledgePoint.findMany({ where: { id: { in: kpIds } } }),
      prisma.answerRecord.findMany({
        where: { studentId: session.user.id, questionId: { in: questionIds } },
        orderBy: { id: "desc" },
      }),
    ]);
    const kpById = new Map(kps.map((k) => [k.id, k]));
    const lastRecord = new Map<string, (typeof records)[number]>();
    for (const r of records) if (!lastRecord.has(r.questionId)) lastRecord.set(r.questionId, r);

    return ok(
      wqs.map((w) => {
        const rec = lastRecord.get(w.questionId);
        return {
          id: w.id,
          questionId: w.questionId,
          stem: w.question.stem,
          type: w.question.type,
          options: parseArr<string>(w.question.options),
          answer: w.question.answer,
          analysis: w.question.analysis,
          difficulty: w.question.difficulty,
          kpIds: parseArr(w.kpIds),
          kpCodes: parseArr(w.kpIds)
            .map((id) => kpById.get(id)?.code)
            .filter(Boolean),
          kpNames: parseArr(w.kpIds)
            .map((id) => kpById.get(id)?.name)
            .filter(Boolean),
          wrongCount: w.wrongCount,
          mastered: w.mastered,
          lastWrongAt: w.lastWrongAt,
          lastResponse: rec?.response ?? null,
          errorTags: rec ? parseArr(rec.errorTags) : [],
          errorAnalysis: rec?.errorAnalysis ?? null,
        };
      })
    );
  } catch (e) {
    return fail(e);
  }
}
