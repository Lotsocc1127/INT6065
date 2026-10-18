/**
 * 作业详情「教师分支」提交数据（从 app/api/assignments/[id]/route.ts 抽出）：
 * 详情接口与 Excel 成绩单导出共用，保证两处口径一致。
 */
import { prisma } from "./prisma";
import { parseArr } from "./json";

export interface TeacherSubmissionRow {
  id: string;
  studentId: string;
  studentName: string;
  studentNo: string | null;
  submittedAt: Date;
  avgScore: number | null;
  answers: {
    id: string;
    questionId: string;
    response: string;
    isCorrect: boolean | null;
    score: number | null;
    timeSpentMs: number | null;
    errorTags: string[];
    errorAnalysis: string | null;
    improvement: string | null;
    confidence: number | null;
    reviewStatus: string;
  }[];
}

export async function loadTeacherSubmissions(assignmentId: string): Promise<TeacherSubmissionRow[]> {
  const subs = await prisma.submission.findMany({
    where: { assignmentId },
    include: { student: true, answers: true },
    orderBy: { submittedAt: "asc" },
  });
  return subs.map((s) => ({
    id: s.id,
    studentId: s.studentId,
    studentName: s.student.name,
    studentNo: s.student.studentNo,
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
