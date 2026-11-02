import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { gradeAnswer } from "@/lib/grading";
import { prisma } from "@/lib/prisma";
import { applyReview } from "@/lib/review";
import { assertTeacherCanAccessAssignment } from "@/lib/teacher-scope";

export const dynamic = "force-dynamic";

/** POST /api/ai/grade —— 单题批改（教师手动批改入口）：{questionId, response, answerRecordId?}
 * 落库分支（answerRecordId）按教师绑定范围校验（班主任本班/科目教师本学科） */
export async function POST(req: NextRequest) {
  try {
    const session = await requireApiUser(["TEACHER", "ADMIN"]);
    const body = await req.json();
    const question = await prisma.question.findUnique({ where: { id: String(body?.questionId ?? "") } });
    if (!question) return ok({ error: "题目不存在" }, 404);
    const result = await gradeAnswer(question, String(body?.response ?? ""));

    // 传了 answerRecordId：批改结果落库（AI 重批持久化，联动掌握度/错题本）
    const answerRecordId = body?.answerRecordId ? String(body.answerRecordId) : null;
    if (!answerRecordId) return ok(result);

    const record = await prisma.answerRecord.findUnique({
      where: { id: answerRecordId },
      include: {
        submission: { select: { assignment: { select: { classId: true, subjectId: true } } } },
      },
    });
    if (!record) return ok({ error: "作答记录不存在" }, 404);
    assertTeacherCanAccessAssignment(session.user, record.submission.assignment);

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
