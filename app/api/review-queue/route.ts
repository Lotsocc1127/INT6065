import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { parseArr } from "@/lib/json";
import { prisma } from "@/lib/prisma";
import { applyReview } from "@/lib/review";

export const dynamic = "force-dynamic";

/** GET /api/review-queue —— 待复核队列（低置信度/未批改的解答题作答） */
export async function GET(req: NextRequest) {
  try {
    await requireApiUser(["TEACHER", "ADMIN"]);
    const sp = req.nextUrl.searchParams;
    const subjectCode = sp.get("subject") ?? undefined;
    const classId = sp.get("classId") ?? undefined;
    const countOnly = sp.get("countOnly") === "1";

    const subject = subjectCode
      ? await prisma.subject.findUnique({ where: { code: subjectCode } })
      : null;

    const where = {
      reviewStatus: "needs_review",
      ...(subject ? { question: { subjectId: subject.id } } : {}),
      ...(classId ? { submission: { assignment: { classId } } } : {}),
    };

    if (countOnly) {
      const count = await prisma.answerRecord.count({ where });
      return ok({ count });
    }

    const recs = await prisma.answerRecord.findMany({
      where,
      orderBy: { submission: { submittedAt: "asc" } },
      include: {
        question: { include: { subject: true } },
        submission: {
          include: { student: true, assignment: { include: { class: true } } },
        },
      },
    });

    return ok({
      count: recs.length,
      items: recs.map((r) => ({
        id: r.id,
        studentId: r.studentId,
        studentName: r.submission.student.name,
        className: r.submission.assignment.class.name,
        assignmentId: r.submission.assignmentId,
        assignmentTitle: r.submission.assignment.title,
        submittedAt: r.submission.submittedAt,
        questionId: r.questionId,
        stem: r.question.stem,
        type: r.question.type,
        options: parseArr<string>(r.question.options),
        answer: r.question.answer,
        analysis: r.question.analysis,
        response: r.response,
        isCorrect: r.isCorrect,
        score: r.score,
        confidence: r.confidence,
        reviewStatus: r.reviewStatus,
        errorTags: parseArr(r.errorTags),
        errorAnalysis: r.errorAnalysis,
        improvement: r.improvement,
      })),
    });
  } catch (e) {
    return fail(e);
  }
}

/** POST /api/review-queue —— 复核操作：confirm 确认 AI 判分 / override 教师改判 */
export async function POST(req: NextRequest) {
  try {
    await requireApiUser(["TEACHER", "ADMIN"]);
    const body = await req.json();
    const { recordId, action, isCorrect, score, errorAnalysis, errorTags } = body as {
      recordId?: string;
      action?: string;
      isCorrect?: unknown;
      score?: unknown;
      errorAnalysis?: unknown;
      errorTags?: unknown;
    };
    if (!recordId) return ok({ error: "缺少 recordId" }, 400);

    const record = await prisma.answerRecord.findUnique({ where: { id: recordId } });
    if (!record) return ok({ error: "作答记录不存在" }, 404);

    if (action === "confirm") {
      if (record.isCorrect == null || record.score == null) {
        return ok({ error: "该作答尚未判分，请使用「改判」" }, 400);
      }
      const { mastery } = await applyReview({
        recordId,
        isCorrect: record.isCorrect,
        score: record.score,
        errorAnalysis: record.errorAnalysis,
        errorTags: parseArr(record.errorTags),
        confidence: 1,
        reviewer: "teacher",
      });
      return ok({ mastery });
    }

    if (action === "override") {
      if (typeof isCorrect !== "boolean") return ok({ error: "isCorrect 必须为布尔值" }, 400);
      if (typeof score !== "number" || !Number.isFinite(score)) {
        return ok({ error: "score 必须为 0-1 数字" }, 400);
      }
      const { mastery } = await applyReview({
        recordId,
        isCorrect,
        score: Math.min(1, Math.max(0, score)),
        errorAnalysis: typeof errorAnalysis === "string" ? errorAnalysis : undefined,
        errorTags: Array.isArray(errorTags) ? errorTags.map(String) : undefined,
        confidence: 1,
        reviewer: "teacher",
      });
      return ok({ mastery });
    }

    return ok({ error: "action 必须为 confirm 或 override" }, 400);
  } catch (e) {
    return fail(e);
  }
}
