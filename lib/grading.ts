/**
 * 提交作业的完整处理链（开发文档第 8 节「提交接口处理顺序」）：
 * 1. 保存每条作答 → 2. 客观题直接判对错 / 解答题调用 AI 批改
 * → 3. 按知识点聚合正确率更新掌握度（写 MasteryPoint）
 * → 4. 错题写入/更新错题本 → 5. 返回批改结果 + 最新掌握度
 */
import { Prisma, type Question } from "@prisma/client";
import { prisma } from "./prisma";
import { parseArr, toArrStr, clamp } from "./json";
import { avg, tierOf, updateMastery, type Tier } from "./mastery";
import { llmConfigured, llmJson } from "./llm";
import { GRADE_SYSTEM } from "./prompts";

/** 学生某科层级：该科各知识点掌握度平均 → tierOf（无数据视为基础层） */
export async function studentTierOf(studentId: string, subjectId: string): Promise<Tier> {
  const rows = await prisma.mastery.findMany({
    where: { studentId, subjectId },
    select: { value: true },
  });
  if (!rows.length) return "foundation";
  return tierOf(avg(rows.map((r) => r.value)));
}

export interface AnswerInput {
  questionId: string;
  response: string;
  timeSpentMs?: number;
}

export interface GradedAnswer {
  questionId: string;
  response: string;
  timeSpentMs: number | null;
  isCorrect: boolean | null;
  score: number | null;
  errorTags: string[];
  errorAnalysis: string | null;
  improvement: string | null;
  aiGraded: boolean;
}

/** 填空题答案归一化：去空白/标点、转小写，支持 | 分隔的多个可接受答案 */
export function normalizeResponse(s: string): string {
  return s
    .trim()
    .replace(/\s+/g, "")
    .replace(/[。．，,；;]/g, "")
    .toLowerCase();
}

/** 客观题（选择/填空）确定性判分 */
export function gradeObjective(question: Question, response: string): { isCorrect: boolean } {
  if (question.type === "SINGLE_CHOICE") {
    return { isCorrect: response.trim().toUpperCase() === question.answer.trim().toUpperCase() };
  }
  const accepts = question.answer.split("|").map(normalizeResponse);
  return { isCorrect: accepts.includes(normalizeResponse(response)) };
}

/** 单题批改：客观题本地判定；解答题调用 /ai/grade（无 API Key 时标记待人工批改） */
export async function gradeAnswer(question: Question, response: string): Promise<Omit<GradedAnswer, "questionId" | "response" | "timeSpentMs">> {
  if (question.type !== "OPEN_RESPONSE") {
    const { isCorrect } = gradeObjective(question, response);
    return {
      isCorrect,
      score: isCorrect ? 1 : 0,
      errorTags: [],
      errorAnalysis: isCorrect ? null : question.analysis ?? null,
      improvement: null,
      aiGraded: false,
    };
  }
  if (!llmConfigured()) {
    return {
      isCorrect: null,
      score: null,
      errorTags: [],
      errorAnalysis: "未配置 LLM API Key（.env），本题待人工批改。",
      improvement: null,
      aiGraded: false,
    };
  }
  try {
    const g = await llmJson<{
      isCorrect: boolean;
      score: number;
      errorTags: string[];
      errorAnalysis: string;
      improvement: string;
    }>([
      { role: "system", content: GRADE_SYSTEM },
      {
        role: "user",
        content: [
          `题目：${question.stem}`,
          question.options ? `选项：${JSON.stringify(parseArr(question.options))}` : "",
          `标准答案：${question.answer}`,
          question.analysis ? `解析：${question.analysis}` : "",
          `学生作答：${response}`,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ]);
    return {
      isCorrect: Boolean(g.isCorrect),
      score: clamp(Number(g.score) || 0, 0, 1),
      errorTags: Array.isArray(g.errorTags) ? g.errorTags : [],
      errorAnalysis: g.errorAnalysis ?? null,
      improvement: g.improvement ?? null,
      aiGraded: true,
    };
  } catch (e) {
    return {
      isCorrect: null,
      score: null,
      errorTags: [],
      errorAnalysis: `AI 批改失败：${e instanceof Error ? e.message : "未知错误"}（待人工批改）`,
      improvement: null,
      aiGraded: false,
    };
  }
}

export class SubmissionError extends Error {
  status = 400;
}

/**
 * 处理一次提交：
 * - 校验作业与权限，每人每作业仅可提交一次（演示规则）
 * - 逐题批改 → 写入 AnswerRecord / Submission
 * - 按知识点聚合本次得分率 → 掌握度加权更新 + MasteryPoint
 * - 错题（答错或得分 < 0.6）写入/更新错题本
 * - 返回批改结果与最新掌握度
 *
 * 写入用批量事务（依赖数据先在事务外预读）：
 * Neon Pooled 连接跑交互式事务会因逐条往返超时（Prisma 默认 5s），报 P2028。
 */
export async function processSubmission(opts: {
  assignmentId: string;
  studentId: string;
  studentClassId: string | null;
  answers: AnswerInput[];
}) {
  const assignment = await prisma.assignment.findUnique({
    where: { id: opts.assignmentId },
    include: { questions: { include: { question: true }, orderBy: { order: "asc" } } },
  });
  if (!assignment) throw new SubmissionError("作业不存在");
  if (opts.studentClassId !== assignment.classId) throw new SubmissionError("该作业不属于你所在的班级");
  const existing = await prisma.submission.findUnique({
    where: { assignmentId_studentId: { assignmentId: assignment.id, studentId: opts.studentId } },
  });
  if (existing) throw new SubmissionError("你已提交过该作业（演示版每人限提交一次）");

  // 分层作业：仅可见该生层级（或全体）的题目
  const myTier = await studentTierOf(opts.studentId, assignment.subjectId);
  const visible = assignment.questions.filter((aq) => !aq.tier || aq.tier === myTier);
  const qById = new Map(visible.map((aq) => [aq.question.id, aq.question]));
  const inputs = opts.answers.filter((a) => qById.has(a.questionId));
  if (!inputs.length) throw new SubmissionError("作答为空");

  // 逐题批改
  const graded: GradedAnswer[] = [];
  for (const a of inputs) {
    const q = qById.get(a.questionId)!;
    const g = await gradeAnswer(q, a.response);
    graded.push({
      questionId: a.questionId,
      response: a.response,
      timeSpentMs: a.timeSpentMs ?? null,
      ...g,
    });
  }

  // 按知识点聚合本次得分率
  const kpRates = new Map<string, { sum: number; n: number }>();
  for (const g of graded) {
    const kpIds = parseArr(qById.get(g.questionId)!.kpIds);
    if (g.score == null) continue;
    for (const kpId of kpIds) {
      const e = kpRates.get(kpId) ?? { sum: 0, n: 0 };
      e.sum += g.score;
      e.n += 1;
      kpRates.set(kpId, e);
    }
  }

  // 事务前预读（Neon Pooled 连接不支持交互式事务：逐条查询往返慢，会超 Prisma 5s 事务超时并报
  // P2028「Transaction not found / already closed」。这里先读出依赖数据，再用批量事务一次写入）
  const kpIds = [...kpRates.keys()];
  const wrongIds = graded
    .filter((g) => g.isCorrect === false || (g.score != null && g.score < 0.6))
    .map((g) => g.questionId);
  const [prevRows, kpRows, wqRows] = await Promise.all([
    prisma.mastery.findMany({ where: { studentId: opts.studentId, kpId: { in: kpIds } } }),
    prisma.knowledgePoint.findMany({ where: { id: { in: kpIds } } }),
    prisma.wrongQuestion.findMany({ where: { studentId: opts.studentId, questionId: { in: wrongIds } } }),
  ]);
  const prevMap = new Map(prevRows.map((r) => [r.kpId, r.value]));
  const kpMap = new Map(kpRows.map((k) => [k.id, k]));
  const wqMap = new Map(wqRows.map((w) => [w.questionId, w]));

  // 批量事务：写提交、更新掌握度、写错题
  const ops: Prisma.PrismaPromise<any>[] = [];
  ops.push(
    prisma.submission.create({
      data: {
        assignmentId: assignment.id,
        studentId: opts.studentId,
        answers: {
          create: graded.map((g) => ({
            questionId: g.questionId,
            kpIds: toArrStr(parseArr(qById.get(g.questionId)!.kpIds)),
            studentId: opts.studentId,
            response: g.response,
            isCorrect: g.isCorrect,
            score: g.score,
            timeSpentMs: g.timeSpentMs,
            errorTags: toArrStr(g.errorTags),
            errorAnalysis: g.errorAnalysis,
            improvement: g.improvement,
          })),
        },
      },
    })
  );

  const masteryUpdates: Record<string, number> = {};
  for (const [kpId, rate] of kpRates) {
    const kp = kpMap.get(kpId);
    if (!kp) continue;
    const next = updateMastery(prevMap.get(kpId) ?? 0.3, rate.sum / rate.n);
    ops.push(
      prisma.mastery.upsert({
        where: { studentId_kpId: { studentId: opts.studentId, kpId } },
        create: {
          studentId: opts.studentId,
          kpId,
          subjectId: kp.subjectId,
          value: next,
          history: { create: { value: next } },
        },
        update: {
          value: next,
          history: { create: { value: next } },
        },
      })
    );
    masteryUpdates[kpId] = next;
  }

  for (const g of graded) {
    const wrong = g.isCorrect === false || (g.score != null && g.score < 0.6);
    if (!wrong) continue;
    const kpIdsG = parseArr(qById.get(g.questionId)!.kpIds);
    const existingWq = wqMap.get(g.questionId);
    if (existingWq) {
      ops.push(
        prisma.wrongQuestion.update({
          where: { id: existingWq.id },
          data: { wrongCount: { increment: 1 }, lastWrongAt: new Date(), mastered: false },
        })
      );
    } else {
      ops.push(
        prisma.wrongQuestion.create({
          data: {
            studentId: opts.studentId,
            questionId: g.questionId,
            kpIds: toArrStr(kpIdsG),
            wrongCount: 1,
          },
        })
      );
    }
  }

  await prisma.$transaction(ops);

  return { results: graded, mastery: masteryUpdates };
}
