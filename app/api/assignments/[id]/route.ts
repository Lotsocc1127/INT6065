import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { parseArr } from "@/lib/json";
import { studentTierOf } from "@/lib/grading";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** GET /api/assignments/:id —— 作业详情
 * 教师：全部提交与批改；学生：题目（提交后可见答案/解析）+ 自己的批改结果 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireApiUser();
    const assignment = await prisma.assignment.findUnique({
      where: { id: params.id },
      include: {
        subject: true,
        class: true,
        questions: { include: { question: true }, orderBy: { order: "asc" } },
      },
    });
    if (!assignment) return ok({ error: "作业不存在" }, 404);
    if (
      session.user.role === "STUDENT" &&
      session.user.classId !== assignment.classId
    ) {
      return ok({ error: "该作业不属于你所在的班级" }, 403);
    }

    const mySubmission =
      session.user.role === "STUDENT"
        ? await prisma.submission.findUnique({
            where: {
              assignmentId_studentId: {
                assignmentId: assignment.id,
                studentId: session.user.id,
              },
            },
            include: { answers: true },
          })
        : null;

    // 题目答案/解析：教师始终可见；学生仅在提交后可见（防止提前看答案）
    const reveal = session.user.role !== "STUDENT" || Boolean(mySubmission);

    // 分层作业：学生仅可见自己层级（或全体）的题目
    let myTier: string | null = null;
    let visibleQuestions = assignment.questions;
    if (session.user.role === "STUDENT") {
      myTier = await studentTierOf(session.user.id, assignment.subjectId);
      visibleQuestions = assignment.questions.filter((aq) => !aq.tier || aq.tier === myTier);
    }

    const kpIds = [...new Set(visibleQuestions.flatMap((aq) => parseArr(aq.question.kpIds)))];
    const kps = await prisma.knowledgePoint.findMany({ where: { id: { in: kpIds } } });
    const kpById = new Map(kps.map((k) => [k.id, k]));

    let submissions: unknown[] | undefined;
    if (session.user.role !== "STUDENT") {
      const subs = await prisma.submission.findMany({
        where: { assignmentId: assignment.id },
        include: { student: true, answers: true },
        orderBy: { submittedAt: "asc" },
      });
      submissions = subs.map((s) => ({
        id: s.id,
        studentId: s.studentId,
        studentName: s.student.name,
        submittedAt: s.submittedAt,
        avgScore: (() => {
          // 只统计已批改的题目；全部未批改时显示「待批改」
          const scored = s.answers.filter((a) => a.score != null);
          return scored.length
            ? scored.reduce((acc, a) => acc + (a.score ?? 0), 0) / scored.length
            : null;
        })(),
        answers: s.answers.map((a) => ({
          id: a.id,
          questionId: a.questionId,
          response: a.response,
          isCorrect: a.isCorrect,
          score: a.score,
          timeSpentMs: a.timeSpentMs,
          errorTags: parseArr(a.errorTags),
          errorAnalysis: a.errorAnalysis,
          improvement: a.improvement,
          confidence: a.confidence,
          reviewStatus: a.reviewStatus,
        })),
      }));
    }

    return ok({
      assignment: {
        id: assignment.id,
        title: assignment.title,
        type: assignment.type,
        subjectCode: assignment.subject.code,
        subjectName: assignment.subject.name,
        className: assignment.class.name,
        dueAt: assignment.dueAt,
        createdAt: assignment.createdAt,
        studentCount: await prisma.user.count({
          where: { role: "STUDENT", classId: assignment.classId },
        }),
      },
      questions: visibleQuestions.map((aq) => ({
        id: aq.question.id,
        order: aq.order,
        tier: aq.tier,
        type: aq.question.type,
        difficulty: aq.question.difficulty,
        stem: aq.question.stem,
        options: parseArr<string>(aq.question.options),
        kpIds: parseArr(aq.question.kpIds),
        kpCodes: parseArr(aq.question.kpIds)
          .map((id) => kpById.get(id)?.code)
          .filter(Boolean),
        ...(reveal ? { answer: aq.question.answer, analysis: aq.question.analysis } : {}),
      })),
      myTier,
      mySubmission: mySubmission
        ? {
            id: mySubmission.id,
            submittedAt: mySubmission.submittedAt,
            answers: mySubmission.answers.map((a) => ({
              id: a.id,
              questionId: a.questionId,
              response: a.response,
              isCorrect: a.isCorrect,
              score: a.score,
              timeSpentMs: a.timeSpentMs,
              errorTags: parseArr(a.errorTags),
              errorAnalysis: a.errorAnalysis,
              improvement: a.improvement,
              confidence: a.confidence,
              reviewStatus: a.reviewStatus,
            })),
          }
        : null,
      submissions,
    });
  } catch (e) {
    return fail(e);
  }
}
