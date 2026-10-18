/**
 * e2e 数据自清理（scripts/e2e-test.ts 结束时调用；也可由 cleanup-e2e-data.ts 一次性清历史残留）：
 * - 删除本轮/标记的 e2e 作业（按 FK 顺序：作答 → 提交 → 选题 → 作业）、目标、分享链接
 * - 恢复受影响学生的掌握度与错题本。注意：seed 的历史点是装饰性的（value ± 噪音），
 *   Mastery.value 才是权威值，所以不能「取最后历史点当基线」——正确做法与 lib/review.ts
 *   复核改判同一套约定：从当前值逆向回放被删提交（6:4 加权逆运算 (v-0.4r)/0.6），
 *   再正向重放边界之后仍保留的提交。边界后的非 demo 历史点删除后按剩余提交重建。
 * - demo 历史点（source="demo"）保留不动（演示展示层，按需再生，清演示时自有回退逻辑）
 * - 近似性假设（与 review.ts 一致）：逆推对「被删提交都晚于剩余提交」精确；与并发会话
 *   交错时存在小误差（CLAUDE.md 已约定多会话错峰跑 e2e，正常运行满足该假设）
 *
 * 写入走批量事务/串行小批次——共享 Neon Pooled 连接禁交互式事务、忌大批并发（CLAUDE.md）。
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { parseArr } from "../lib/json";
import { updateMastery } from "../lib/mastery";

export interface RunCreated {
  studentId: string | null;
  assignmentIds: string[];
  goalIds: string[];
  shareLinkIds: string[];
  /** 本轮开始时间：清理此后创建的通知（学生侧 + body 含 E2E 的教师侧通知） */
  notificationBoundary?: Date;
  /** 本轮涉及的学生（其通知按边界清扫） */
  notificationUserIds?: string[];
}

/** 被删（或拟删）提交的最小信息：作答的 kp 快照与最终判分（复核改判后的最终值） */
export interface DeletedSub {
  submittedAt: Date;
  answers: { kpIds: string; score: number | null }[];
}

export interface RebuildOptions {
  /** 被删数据的起点（最早被删提交时间）；边界后的非 demo 历史点会被重建 */
  boundary: Date;
  deletedSubs: DeletedSub[];
  /** 预览用：计算时排除这些作业的提交/作答（执行时数据已删，传空数组） */
  excludeAssignmentIds?: string[];
}

/** 删除作业及其作答/提交/选题（FK 依赖顺序） */
export async function deleteAssignments(prisma: PrismaClient, assignmentIds: string[]) {
  if (!assignmentIds.length) return;
  await prisma.answerRecord.deleteMany({
    where: { submission: { assignmentId: { in: assignmentIds } } },
  });
  await prisma.submission.deleteMany({ where: { assignmentId: { in: assignmentIds } } });
  await prisma.assignmentQuestion.deleteMany({ where: { assignmentId: { in: assignmentIds } } });
  await prisma.assignment.deleteMany({ where: { id: { in: assignmentIds } } });
}

/** 按提交聚合各 kp 得分率序列（score 为 null 的待批改作答不参与掌握度，与 processSubmission 一致） */
function rateSeqOf(subs: { submittedAt: Date; answers: { kpIds: string; score: number | null }[] }[]) {
  const seq = new Map<string, { at: Date; rate: number }[]>();
  for (const sub of subs) {
    const rates = new Map<string, { sum: number; n: number }>();
    for (const a of sub.answers) {
      if (a.score == null) continue;
      for (const kpId of parseArr(a.kpIds)) {
        const e = rates.get(kpId) ?? { sum: 0, n: 0 };
        e.sum += a.score;
        e.n += 1;
        rates.set(kpId, e);
      }
    }
    for (const [kpId, { sum, n }] of rates) {
      const list = seq.get(kpId) ?? [];
      list.push({ at: sub.submittedAt, rate: sum / n });
      seq.set(kpId, list);
    }
  }
  return seq;
}

export interface RebuildPlan {
  studentId: string;
  boundary: Date;
  /** 保留/新建的掌握度行：value 为恢复后的值，points 为边界后重建的非 demo 历史点 */
  mastery: {
    kpId: string;
    subjectId: string;
    value: number;
    points: { at: Date; value: number }[];
    existingId: string | null;
  }[];
  /** 纯 e2e 创建的掌握度行（无边界前历史点、无 demo 点、无剩余作答）→ 整行删除 */
  dropMasteryIds: string[];
  wrongUpserts: { questionId: string; kpIds: string; wrongCount: number; lastWrongAt: Date }[];
  /** 剩余作答不再答错的现有错题行 → 删除 */
  wrongDeletes: string[];
}

/** 只读计算重建计划（不写库），供 dry-run 预览与 rebuildStudentStats 执行 */
export async function computeRebuildPlan(
  prisma: PrismaClient,
  studentId: string,
  opts: RebuildOptions
): Promise<RebuildPlan> {
  const exclude = opts.excludeAssignmentIds ?? [];
  const notExcluded = exclude.length ? { assignmentId: { notIn: exclude } } : {};

  // 1) 边界后仍保留的提交（正推用）
  const postSubs = await prisma.submission.findMany({
    where: { studentId, submittedAt: { gte: opts.boundary }, ...notExcluded },
    orderBy: { submittedAt: "asc" },
    select: { submittedAt: true, answers: { select: { kpIds: true, score: true } } },
  });
  const remainingSeq = rateSeqOf(postSubs);
  // 2) 被删提交的得分率序列（逆推用）
  const deletedSeq = rateSeqOf(
    [...opts.deletedSubs].sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime())
  );

  const involvedKps = new Set([...remainingSeq.keys(), ...deletedSeq.keys()]);
  const rows = await prisma.mastery.findMany({
    where: { studentId },
    include: { history: { orderBy: { at: "asc" } } },
  });

  const plan: RebuildPlan = { studentId, boundary: opts.boundary, mastery: [], dropMasteryIds: [], wrongUpserts: [], wrongDeletes: [] };
  const plannedKps = new Set<string>();

  for (const row of rows) {
    const prePoint = row.history.some((h) => h.at < opts.boundary && h.source !== "demo");
    const demoAny = row.history.some((h) => h.source === "demo");
    if (!involvedKps.has(row.kpId)) {
      // 未被删除数据波及：若行只由被删数据创建（无边界前点、无 demo 点）则整行删除，否则不动
      if (!prePoint && !demoAny) plan.dropMasteryIds.push(row.id);
      continue;
    }
    let value = row.value;
    // 逆推：从当前值依次去掉被删提交的贡献（新→旧；review.ts 同款逆运算）
    const del = deletedSeq.get(row.kpId) ?? [];
    for (let i = del.length - 1; i >= 0; i--) {
      value = Math.min(1, Math.max(0, (value - 0.4 * del[i].rate) / 0.6));
    }
    // 正推：重放边界后仍保留的提交，并生成重建历史点
    const points: { at: Date; value: number }[] = [];
    for (const s of remainingSeq.get(row.kpId) ?? []) {
      value = updateMastery(value, s.rate);
      points.push({ at: s.at, value });
    }
    plan.mastery.push({ kpId: row.kpId, subjectId: row.subjectId, value, points, existingId: row.id });
    plannedKps.add(row.kpId);
  }

  // 3) 无掌握度行但被删/剩余提交涉及的 kp（正常不应出现）→ 计划新建行
  const missing = [...involvedKps].filter((kpId) => !plannedKps.has(kpId));
  if (missing.length) {
    const kps = await prisma.knowledgePoint.findMany({
      where: { id: { in: missing } },
      select: { id: true, subjectId: true },
    });
    for (const kp of kps) {
      let value = 0.3;
      const del = deletedSeq.get(kp.id) ?? [];
      for (let i = del.length - 1; i >= 0; i--) {
        value = Math.min(1, Math.max(0, (value - 0.4 * del[i].rate) / 0.6));
      }
      const points: { at: Date; value: number }[] = [];
      for (const s of remainingSeq.get(kp.id) ?? []) {
        value = updateMastery(value, s.rate);
        points.push({ at: s.at, value });
      }
      plan.mastery.push({ kpId: kp.id, subjectId: kp.subjectId, value, points, existingId: null });
    }
  }

  // 4) 错题本：以剩余作答为准重算（与 processSubmission 的错题判定一致）
  const allAnswers = await prisma.answerRecord.findMany({
    where: { studentId, submission: { ...notExcluded } },
    select: {
      questionId: true,
      isCorrect: true,
      score: true,
      kpIds: true,
      submission: { select: { submittedAt: true } },
    },
  });
  const wqAgg = new Map<string, { wrongCount: number; last: Date; kpIds: string }>();
  for (const a of allAnswers) {
    if (!(a.isCorrect === false || (a.score != null && a.score < 0.6))) continue;
    const cur = wqAgg.get(a.questionId);
    if (cur) {
      cur.wrongCount += 1;
      if (a.submission.submittedAt > cur.last) cur.last = a.submission.submittedAt;
    } else {
      wqAgg.set(a.questionId, { wrongCount: 1, last: a.submission.submittedAt, kpIds: a.kpIds });
    }
  }
  const existingWq = await prisma.wrongQuestion.findMany({
    where: { studentId },
    select: { id: true, questionId: true },
  });
  for (const [questionId, agg] of wqAgg) {
    plan.wrongUpserts.push({
      questionId,
      kpIds: agg.kpIds,
      wrongCount: agg.wrongCount,
      lastWrongAt: agg.last,
    });
  }
  plan.wrongDeletes = existingWq.filter((w) => !wqAgg.has(w.questionId)).map((w) => w.id);
  return plan;
}

/** 按计划写库：掌握度批量事务，错题本串行 */
export async function applyRebuildPlan(prisma: PrismaClient, plan: RebuildPlan): Promise<void> {
  const ops: Prisma.PrismaPromise<unknown>[] = [];
  for (const m of plan.mastery) {
    if (m.existingId) {
      ops.push(
        prisma.masteryPoint.deleteMany({
          // 注意：nullable 字段的 { not: "demo" } 不匹配 null，须显式加 OR source:null
          where: {
            masteryId: m.existingId,
            at: { gte: plan.boundary },
            OR: [{ source: null }, { source: { not: "demo" } }],
          },
        })
      );
      ops.push(prisma.mastery.update({ where: { id: m.existingId }, data: { value: m.value } }));
      if (m.points.length) {
        ops.push(
          prisma.masteryPoint.createMany({
            data: m.points.map((p) => ({ masteryId: m.existingId!, value: p.value, at: p.at })),
          })
        );
      }
    } else {
      ops.push(
        prisma.mastery.create({
          data: {
            id: randomUUID(),
            studentId: plan.studentId,
            kpId: m.kpId,
            subjectId: m.subjectId,
            value: m.value,
            history: { create: m.points.map((p) => ({ value: p.value, at: p.at })) },
          },
        })
      );
    }
  }
  for (const id of plan.dropMasteryIds) {
    ops.push(prisma.masteryPoint.deleteMany({ where: { masteryId: id } }));
    ops.push(prisma.mastery.delete({ where: { id } }));
  }
  if (ops.length) await prisma.$transaction(ops);

  for (const w of plan.wrongUpserts) {
    await prisma.wrongQuestion.upsert({
      where: { studentId_questionId: { studentId: plan.studentId, questionId: w.questionId } },
      create: {
        studentId: plan.studentId,
        questionId: w.questionId,
        kpIds: w.kpIds,
        wrongCount: w.wrongCount,
        lastWrongAt: w.lastWrongAt,
      },
      update: { wrongCount: w.wrongCount, lastWrongAt: w.lastWrongAt },
    });
  }
  if (plan.wrongDeletes.length) {
    await prisma.wrongQuestion.deleteMany({ where: { id: { in: plan.wrongDeletes } } });
  }
}

/** 恢复一名学生的掌握度与错题本 */
export async function rebuildStudentStats(
  prisma: PrismaClient,
  studentId: string,
  opts: RebuildOptions
): Promise<void> {
  await applyRebuildPlan(prisma, await computeRebuildPlan(prisma, studentId, opts));
}

/**
 * 清理一次 e2e 运行创建的数据并恢复该生统计。
 * boundary = 本轮最早提交时间；本轮没提交过（半途失败）则只删数据、不重建。
 */
export async function cleanupRun(prisma: PrismaClient, created: RunCreated): Promise<void> {
  if (created.goalIds.length) {
    await prisma.learningGoal.deleteMany({ where: { id: { in: created.goalIds } } });
  }
  if (created.shareLinkIds.length) {
    await prisma.shareLink.deleteMany({ where: { id: { in: created.shareLinkIds } } });
  }
  let deletedSubs: DeletedSub[] = [];
  if (created.assignmentIds.length) {
    deletedSubs = await prisma.submission.findMany({
      where: { assignmentId: { in: created.assignmentIds } },
      select: { submittedAt: true, answers: { select: { kpIds: true, score: true } } },
    });
  }
  await deleteAssignments(prisma, created.assignmentIds);
  if (created.studentId && deletedSubs.length) {
    const boundary = new Date(Math.min(...deletedSubs.map((s) => s.submittedAt.getTime())));
    await rebuildStudentStats(prisma, created.studentId, { boundary, deletedSubs });
  }
  // 通知清扫：本轮涉及学生的通知按边界删；教师侧/其他学生的通知靠 body 里的 E2E 标题兜底
  if (created.notificationBoundary) {
    await prisma.notification.deleteMany({
      where: {
        createdAt: { gte: created.notificationBoundary },
        OR: [
          ...(created.notificationUserIds?.length
            ? [{ userId: { in: created.notificationUserIds } }]
            : []),
          { body: { contains: "E2E" } },
        ],
      },
    });
  }
}

/** 一次性清理：按标记删除库中全部 e2e 目标/作业/分享链接，并恢复受影响学生的统计 */
export async function cleanupAllE2e(prisma: PrismaClient) {
  const asgs = await prisma.assignment.findMany({
    where: { title: { startsWith: "E2E" } },
    select: { id: true },
  });
  const goals = await prisma.learningGoal.findMany({
    where: { content: { startsWith: "E2E" } },
    select: { id: true, studentId: true },
  });
  const deletedSubs: DeletedSub[] = await prisma.submission.findMany({
    where: { assignmentId: { in: asgs.map((a) => a.id) } },
    select: { submittedAt: true, answers: { select: { kpIds: true, score: true } } },
  });
  const boundary = deletedSubs.length
    ? new Date(Math.min(...deletedSubs.map((s) => s.submittedAt.getTime())))
    : null;
  // 提交所属学生从库查（DeletedSub 不带 studentId）
  const subStudents = boundary
    ? await prisma.submission.findMany({
        where: { assignmentId: { in: asgs.map((a) => a.id) } },
        distinct: ["studentId"],
        select: { studentId: true },
      })
    : [];
  const uniqueIds = [...new Set([...goals.map((g) => g.studentId), ...subStudents.map((s) => s.studentId)])];
  const links = await prisma.shareLink.findMany({
    where: boundary
      ? { studentId: { in: uniqueIds }, createdAt: { gte: boundary } }
      : { studentId: { in: uniqueIds } },
    select: { id: true },
  });
  await cleanupRun(prisma, {
    studentId: null,
    assignmentIds: asgs.map((a) => a.id),
    goalIds: goals.map((g) => g.id),
    shareLinkIds: links.map((l) => l.id),
  });
  for (const sid of uniqueIds) {
    if (boundary) await rebuildStudentStats(prisma, sid, { boundary, deletedSubs });
  }
  const notifications = await prisma.notification.deleteMany({
    where: { OR: [{ title: { contains: "E2E" } }, { body: { contains: "E2E" } }] },
  });
  return {
    assignments: asgs.length,
    goals: goals.length,
    links: links.length,
    studentIds: uniqueIds,
    boundary,
    notifications: notifications.count,
  };
}
