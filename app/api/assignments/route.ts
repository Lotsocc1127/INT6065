import { NextRequest } from "next/server";
import { AssignmentType, QuestionType } from "@prisma/client";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { toArrStr } from "@/lib/json";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const TYPES: string[] = Object.values(QuestionType);

const TIER_VALUES = ["foundation", "intermediate", "advanced"];
/** 层级白名单归一化：非法值一律 null（全体可见） */
function normTier(v: unknown): string | null {
  return typeof v === "string" && TIER_VALUES.includes(v) ? v : null;
}

interface GeneratedQuestion {
  stem: string;
  type: string;
  options?: string[] | null;
  answer: string;
  analysis?: string | null;
  kpId: string;
  difficulty?: number;
  tier?: string | null;
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
        questions: { select: { tier: true } },
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
        tiered: a.questions.some((q) => q.tier),
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

    // 支持同时提交：已有题目 id（可带层级）+ AI 生成的新题目（先入库，逐条建以取回 id）
    const rawIds: unknown[] = Array.isArray(questionIds) ? questionIds : [];
    const items: { questionId: string; tier: string | null }[] = rawIds
      .map((q) =>
        typeof q === "string"
          ? { questionId: q, tier: null }
          : q && typeof q === "object"
            ? {
                questionId: String((q as { id?: unknown }).id ?? ""),
                tier: normTier((q as { tier?: unknown }).tier),
              }
            : null
      )
      .filter((q): q is { questionId: string; tier: string | null } => Boolean(q && q.questionId));

    if (questions?.length) {
      for (const q of questions) {
        const created = await prisma.question.create({
          data: {
            subjectId,
            kpIds: toArrStr(q.kpId ? [q.kpId] : []),
            type: (TYPES.includes(q.type) ? q.type : "FILL_BLANK") as QuestionType,
            difficulty: Math.min(5, Math.max(1, Math.round(Number(q.difficulty) || 2))),
            stem: q.stem,
            options: q.options?.length ? toArrStr(q.options) : null,
            answer: q.answer,
            analysis: q.analysis ?? null,
          },
        });
        items.push({ questionId: created.id, tier: normTier(q.tier) });
      }
    }
    if (!items.length) return ok({ error: "至少选择一道题" }, 400);

    const assignment = await prisma.assignment.create({
      data: {
        title,
        type: assignmentType,
        subjectId,
        classId,
        dueAt: dueAt ? new Date(dueAt) : null,
        questions: {
          create: items.map((it, i) => ({
            questionId: it.questionId,
            order: i + 1,
            tier: it.tier,
          })),
        },
      },
    });
    return ok({ id: assignment.id }, 201);
  } catch (e) {
    return fail(e);
  }
}
