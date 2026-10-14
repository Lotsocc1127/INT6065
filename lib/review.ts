/**
 * 教师复核 / AI 重批落库：
 * 更新 AnswerRecord 判分后，联动重算该生相关知识点掌握度（反推 + 重放后续提交）与错题本。
 * 写入全部用批量事务（依赖数据先在事务外预读）——Neon Pooled 连接禁止交互式事务（CLAUDE.md）。
 */
import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { prisma } from "./prisma";
import { parseArr, toArrStr, clamp } from "./json";
import { updateMastery } from "./mastery";

interface ReviewOptions {
  recordId: string;
  isCorrect: boolean | null;
  score: number | null; // 0-1；null = 保持未判分
  errorAnalysis?: string | null;
  errorTags?: string[];
  confidence?: number | null;
  reviewer: "teacher" | "ai";
}

/** 错题判定（与 processSubmission 一致） */
function isWrong(isCorrect: boolean | null, score: number | null): boolean {
  return isCorrect === false || (score != null && score < 0.6);
}

/**
 * 应用一次复核/重批结果。
 * 返回受影响的掌握度 { kpId: value }（demo 数据只改记录本身，返回空对象）。
 */
export async function applyReview(opts: ReviewOptions): Promise<{ mastery: Record<string, number> }> {
  const record = await prisma.answerRecord.findUnique({
    where: { id: opts.recordId },
    include: {
      submission: {
        include: {
          assignment: true,
          answers: { orderBy: { id: "asc" } }, // 同一提交的全部作答（含本记录）
        },
      },
    },
  });
  if (!record) throw new Error("作答记录不存在");

  const newIsCorrect = opts.isCorrect;
  const newScore = opts.score == null ? null : clamp(opts.score, 0, 1);
  const reviewStatus = "reviewed" as const;

  // demo 数据保护：只更新记录本身，不联动真实掌握度/错题本
  if (record.submission.assignment.source === "demo") {
    await prisma.answerRecord.update({
      where: { id: record.id },
      data: {
        isCorrect: newIsCorrect,
        score: newScore,
        errorTags: opts.errorTags ? toArrStr(opts.errorTags) : undefined,
        errorAnalysis: opts.errorAnalysis,
        confidence: opts.confidence ?? 1,
        reviewStatus,
        reviewedAt: new Date(),
      },
    });
    return { mastery: {} };
  }

  // 无变化短路（「确认 AI 判分」）：只标记已复核
  if (newIsCorrect === record.isCorrect && newScore === record.score) {
    await prisma.answerRecord.update({
      where: { id: record.id },
      data: { reviewStatus, reviewedAt: new Date() },
    });
    return { mastery: {} };
  }

  const answers = record.submission.answers;
  const submittedAt = record.submission.submittedAt;
  const studentId = record.studentId;

  // ---- 事务外预读 ----
  // 本次提交涉及的 kp 并集（用 AnswerRecord 的 kpIds 快照）
  const kpIds = new Set<string>();
  for (const a of answers) for (const id of parseArr(a.kpIds)) kpIds.add(id);

  // 后续提交（按时间升序）——复核改判后需按序重放其得分率
  const laterSubs = await prisma.submission.findMany({
    where: { studentId, submittedAt: { gt: submittedAt } },
    orderBy: { submittedAt: "asc" },
    include: { answers: { orderBy: { id: "asc" } } },
  });

  const kpRows = await prisma.knowledgePoint.findMany({ where: { id: { in: [...kpIds] } } });
  const kpMap = new Map(kpRows.map((k) => [k.id, k]));
  const masteryRows = await prisma.mastery.findMany({ where: { studentId, kpId: { in: [...kpIds] } } });
  const masteryMap = new Map(masteryRows.map((m) => [m.kpId, m]));

  // 错题本现状与「该题其他错答记录数」
  const wq = await prisma.wrongQuestion.findUnique({
    where: { studentId_questionId: { studentId, questionId: record.questionId } },
  });
  const otherWrong = await prisma.answerRecord.count({
    where: {
      studentId,
      questionId: record.questionId,
      isCorrect: false,
      id: { not: record.id },
    },
  });

  // ---- 掌握度重算（旧得分率反推 → 新得分率应用 → 重放后续提交） ----
  const rateOf = (records: { kpIds: string; score: number | null }[], kpId: string) => {
    let sum = 0;
    let n = 0;
    for (const r of records) {
      if (r.score == null || !parseArr(r.kpIds).includes(kpId)) continue;
      sum += r.score;
      n += 1;
    }
    return n ? sum / n : null;
  };

  const ops: Prisma.PrismaPromise<unknown>[] = [];
  const masteryOut: Record<string, number> = {};
  const submittedAtRef = submittedAt;

  for (const kpId of kpIds) {
    const kp = kpMap.get(kpId);
    if (!kp) continue;
    const mastery = masteryMap.get(kpId);

    // 旧得分率（本记录用旧值）
    const oldRecs = answers.map((a) =>
      a.id === record.id ? { kpIds: a.kpIds, score: record.score } : { kpIds: a.kpIds, score: a.score }
    );
    const oldRate = rateOf(oldRecs, kpId);
    // 新得分率（本记录用新值）
    const newRecs = answers.map((a) =>
      a.id === record.id ? { kpIds: a.kpIds, score: newScore } : { kpIds: a.kpIds, score: a.score }
    );
    const newRate = rateOf(newRecs, kpId);

    // 反推提交前值（next = prev*0.6 + rate*0.4 → prev = (next - 0.4*rate)/0.6）
    let value = mastery?.value ?? 0.3;
    if (oldRate != null && mastery) value = clamp((value - 0.4 * oldRate) / 0.6, 0, 1);
    const base = newRate != null ? updateMastery(value, newRate) : value;

    // 重放后续提交，递推各时间点的值（点按时间顺序生成）
    const points: { value: number; at: Date }[] = [];
    if (newRate != null) points.push({ value: base, at: submittedAtRef });
    let running = base;
    for (const ls of laterSubs) {
      const r = rateOf(ls.answers, kpId);
      if (r == null) continue;
      running = updateMastery(running, r);
      points.push({ value: running, at: ls.submittedAt });
    }
    masteryOut[kpId] = running;

    const masteryId = mastery?.id ?? randomUUID();
    // 点创建依赖 mastery 行存在（新行 FK）→ upsert 先入数组
    ops.push(
      prisma.mastery.upsert({
        where: { studentId_kpId: { studentId, kpId } },
        create: { id: masteryId, studentId, kpId, subjectId: kp.subjectId, value: running },
        update: { value: running },
      })
    );
    ops.push(
      prisma.masteryPoint.deleteMany({ where: { masteryId, at: { gte: submittedAtRef } } })
    );
    for (const p of points) {
      ops.push(prisma.masteryPoint.create({ data: { masteryId, value: p.value, at: p.at } }));
    }
  }

  // ---- 错题本 ----
  const oldWrong = isWrong(record.isCorrect, record.score);
  const newWrong = isWrong(newIsCorrect, newScore);
  if (!oldWrong && newWrong) {
    if (wq) {
      ops.push(
        prisma.wrongQuestion.update({
          where: { id: wq.id },
          data: { wrongCount: { increment: 1 }, lastWrongAt: new Date(), mastered: false },
        })
      );
    } else {
      ops.push(
        prisma.wrongQuestion.create({
          data: {
            studentId,
            questionId: record.questionId,
            kpIds: record.kpIds,
            wrongCount: 1,
            lastWrongAt: new Date(),
          },
        })
      );
    }
  } else if (oldWrong && !newWrong) {
    if (wq) {
      if (otherWrong === 0) {
        ops.push(prisma.wrongQuestion.delete({ where: { id: wq.id } }));
      } else {
        ops.push(
          prisma.wrongQuestion.update({
            where: { id: wq.id },
            data: { wrongCount: Math.max(1, wq.wrongCount - 1) },
          })
        );
      }
    }
  }

  // ---- 记录本身 ----
  ops.push(
    prisma.answerRecord.update({
      where: { id: record.id },
      data: {
        isCorrect: newIsCorrect,
        score: newScore,
        errorTags: opts.errorTags ? toArrStr(opts.errorTags) : undefined,
        errorAnalysis: opts.errorAnalysis,
        confidence: opts.confidence ?? 1,
        reviewStatus,
        reviewedAt: new Date(),
      },
    })
  );

  await prisma.$transaction(ops);
  return { mastery: masteryOut };
}
