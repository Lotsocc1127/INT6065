import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { gradeAnswer } from "@/lib/grading";
import { prisma } from "@/lib/prisma";
import { applyReview } from "@/lib/review";

export const dynamic = "force-dynamic";

/** POST /api/ai/grade —— 单题批改（教师手动批改入口）：{questionId, response, answerRecordId?} */
export async function POST(req: NextRequest) {
  try {
    await requireApiUser(["TEACHER", "ADMIN"]);
    const body = await req.json();
    const question = await prisma.question.findUnique({ where: { id: String(body?.questionId ?? "") } });
    if (!question) return ok({ error: "题目不存在" }, 404);
    const result = await gradeAnswer(question, String(body?.response ?? ""));

    // 传了 answerRecordId：批改结果落库（AI 重批持久化，联动掌握度/错题本）
    const answerRecordId = body?.answerRecordId ? String(body.answerRecordId) : null;
    if (!answerRecordId) return ok(result);

    const record = await prisma.answerRecord.findUnique({ where: { id: answerRecordId } });
    if (!record) return ok({ error: "作答记录不存在" }, 404);

    // 未配 key / AI 失败（isCorrect null）：不写库，保留待复核状态
    if (result.isCorrect === null || result.score === null) {
      return ok({ ...result, persisted: false });
    }
    const { mastery } = await applyReview({
      recordId: answerRecordId,
      isCorrect: result.isCorrect,
      score: result.score,
      errorAnalysis: result.errorAnalysis,
      errorTags: result.errorTags,
      confidence: result.confidence,
      reviewer: "ai",
    });
    return ok({ ...result, persisted: true, mastery });
  } catch (e) {
    return fail(e);
  }
}
