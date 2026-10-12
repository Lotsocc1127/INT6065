import { NextRequest } from "next/server";
import { AssignmentType, QuestionType } from "@prisma/client";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { toArrStr } from "@/lib/json";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const TYPES: string[] = Object.values(QuestionType);

interface GeneratedQuestion {
  stem: string;
  type: string;
  options?: string[] | null;
  answer: string;
  analysis?: string | null;
  kpId: string;
  difficulty?: number;
}

/** GET /api/assignments —— 作业列表（教师：全部；学生：本班 + 自己的提交状态） */
export async function GET(req: NextRequest) {
  try {
    const session = await requireApiUser();
    const sp = req.nextUrl.searchParams;
    const subjectCode = sp.get("subject") ?? undefined;
    const subject = subjectCode ? await prisma.subject.findUnique({ where: { code: subjectCode } }) : null;

    const where = {
      ...(subject ? { subjectId: subject.id } : {}),
      ...(session.user.role === "STUDENT" ? { classId: session.user.classId ?? "" } : {}),
    };

    const assignments = await prisma.assignment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        subject: true,
        class: true,
        _count: { select: { questions: true, submissions: true } },
      },
    });

    let mySubmissions: Map<string, string> = new Map();
    if (session.user.role === "STUDENT") {
      const subs = await prisma.submission.findMany({
        where: {
          studentId: session.user.id,
          assignmentId: { in: assignments.map((a) => a.id) },
        },
        select: { assignmentId: true, id: true },
      });
      mySubmissions = new Map(subs.map((s) => [s.assignmentId, s.id]));
    }

    return ok(
      assignments.map((a) => ({
        id: a.id,
        title: a.title,
        type: a.type,
        subjectCode: a.subject.code,
        subjectName: a.subject.name,
        className: a.class.name,
        dueAt: a.dueAt,
        createdAt: a.createdAt,
        questionCount: a._count.questions,
        submissionCount: a._count.submissions,
        mySubmissionId: mySubmissions.get(a.id) ?? null,
      }))
    );
  } catch (e) {
    return fail(e);
  }
}

/** POST /api/assignments —— 布置作业：可传已有题目 id，或传 AI 生成的题目（服务端入库） */
export async function POST(req: NextRequest) {
  try {
    await requireApiUser(["TEACHER", "ADMIN"]);
    const body = await req.json();
    const { title, type, subjectId, classId, dueAt, questionIds, questions } = body as {
      title?: string;
      type?: string;
      subjectId?: string;
      classId?: string;
      dueAt?: string;
      questionIds?: string[];
      questions?: GeneratedQuestion[];
    };
    if (!title || !subjectId || !classId) return ok({ error: "缺少标题/科目/班级" }, 400);
    if (!questionIds?.length && !questions?.length) return ok({ error: "至少选择一道题" }, 400);

    const assignmentType = type === "QUIZ" ? AssignmentType.QUIZ : AssignmentType.HOMEWORK;

    // 支持同时提交：已有题目 id + AI 生成的新题目（先入库）
    let ids: string[] = [...(questionIds ?? [])];
    if (questions?.length) {
      const created = await prisma.question.createMany({
        data: questions.map((q) => ({
          subjectId,
          kpIds: toArrStr(q.kpId ? [q.kpId] : []),
          type: (TYPES.includes(q.type) ? q.type : "FILL_BLANK") as QuestionType,
          difficulty: Math.min(5, Math.max(1, Math.round(Number(q.difficulty) || 2))),
          stem: q.stem,
          options: q.options?.length ? toArrStr(q.options) : null,
          answer: q.answer,
          analysis: q.analysis ?? null,
        })),
      });
      const newQuestions = await prisma.question.findMany({
        where: { subjectId },
        orderBy: { id: "desc" },
        take: created.count,
      });
      ids = [...ids, ...newQuestions.map((q) => q.id)];
    }
    if (!ids.length) return ok({ error: "至少选择一道题" }, 400);

    const assignment = await prisma.assignment.create({
      data: {
        title,
        type: assignmentType,
        subjectId,
        classId,
        dueAt: dueAt ? new Date(dueAt) : null,
        questions: {
          create: ids.map((questionId, i) => ({ questionId, order: i + 1 })),
        },
      },
    });
    return ok({ id: assignment.id }, 201);
  } catch (e) {
    return fail(e);
  }
}
