/**
 * 补救作业聚合：按知识点统计班级未攻克错题（人次/人数/层级分布/高频错因/示例题干）。
 */
import { prisma } from "./prisma";
import { parseArr } from "./json";
import { avg, tierOf, type Tier } from "./mastery";

export interface RemedialKp {
  kpId: string;
  code: string;
  name: string;
  wrongCount: number; // 错题人次（一条错题按 kpIds 中每个 kp 各计一次）
  studentCount: number; // 涉及学生数
  tierDistribution: Record<Tier, number>;
  commonErrorTags: { tag: string; count: number }[];
  sampleStems: string[];
}

export async function aggregateRemedialKps(opts: {
  subjectId: string;
  classId?: string;
}): Promise<RemedialKp[]> {
  const students = await prisma.user.findMany({
    where: { role: "STUDENT", ...(opts.classId ? { classId: opts.classId } : {}) },
    select: { id: true },
  });
  const studentIds = students.map((s) => s.id);

  const wqs = await prisma.wrongQuestion.findMany({
    where: {
      mastered: false,
      ...(studentIds.length ? { studentId: { in: studentIds } } : {}),
      question: { subjectId: opts.subjectId },
    },
    include: { question: { select: { id: true, kpIds: true, stem: true } } },
  });
  if (!wqs.length) return [];

  // 知识点基础信息
  const kpIdSet = new Set(wqs.flatMap((w) => parseArr(w.question.kpIds)));
  const kps = await prisma.knowledgePoint.findMany({ where: { id: { in: [...kpIdSet] } } });
  const kpById = new Map(kps.map((k) => [k.id, k]));

  // 这些学生该科目的平均掌握度 → 层级
  const masteries = await prisma.mastery.findMany({
    where: { studentId: { in: studentIds }, subjectId: opts.subjectId },
    select: { studentId: true, value: true },
  });
  const tierByStudent = new Map<string, Tier>();
  const valsByStudent = new Map<string, number[]>();
  for (const m of masteries) {
    const arr = valsByStudent.get(m.studentId) ?? [];
    arr.push(m.value);
    valsByStudent.set(m.studentId, arr);
  }
  for (const [sid, vals] of valsByStudent) tierByStudent.set(sid, tierOf(avg(vals)));

  // 高频错因：这些错题在作答记录中的错误标签
  const questionIds = [...new Set(wqs.map((w) => w.questionId))];
  const recs = await prisma.answerRecord.findMany({
    where: { questionId: { in: questionIds }, isCorrect: false },
    select: { questionId: true, errorTags: true },
  });

  const agg = new Map<string, RemedialKp>();
  for (const w of wqs) {
    for (const kpId of parseArr(w.question.kpIds)) {
      const kp = kpById.get(kpId);
      if (!kp) continue;
      const e =
        agg.get(kpId) ??
        ({
          kpId,
          code: kp.code,
          name: kp.name,
          wrongCount: 0,
          studentCount: 0,
          tierDistribution: { foundation: 0, intermediate: 0, advanced: 0 },
          commonErrorTags: [],
          sampleStems: [],
        } satisfies RemedialKp);
      e.wrongCount += 1;
      if (!e.sampleStems.includes(w.question.stem) && e.sampleStems.length < 2) {
        e.sampleStems.push(w.question.stem);
      }
      agg.set(kpId, e);
    }
  }
  // 学生数（按 kp 去重）与层级分布
  const kpStudents = new Map<string, Set<string>>();
  for (const w of wqs) {
    for (const kpId of parseArr(w.question.kpIds)) {
      if (!kpById.has(kpId)) continue;
      const set = kpStudents.get(kpId) ?? new Set();
      set.add(w.studentId);
      kpStudents.set(kpId, set);
    }
  }
  for (const [kpId, set] of kpStudents) {
    const e = agg.get(kpId)!;
    e.studentCount = set.size;
    for (const sid of set) {
      const t = tierByStudent.get(sid) ?? "foundation";
      e.tierDistribution[t] += 1;
    }
  }
  // 高频错因（按该 kp 的错题归集标签）
  const tagByQuestion = new Map<string, string[]>();
  for (const r of recs) {
    const tags = parseArr(r.errorTags);
    if (tags.length) tagByQuestion.set(r.questionId, tags);
  }
  for (const e of agg.values()) {
    const counts = new Map<string, number>();
    for (const w of wqs) {
      if (!parseArr(w.question.kpIds).includes(e.kpId)) continue;
      for (const t of tagByQuestion.get(w.questionId) ?? []) {
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
    e.commonErrorTags = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([tag, count]) => ({ tag, count }));
  }

  return [...agg.values()].sort((a, b) => b.studentCount - a.studentCount);
}

/** auto 层级：取人数最多的层级（并列时取较低层） */
export function pickTier(aggs: RemedialKp[]): Tier {
  const dist: Record<Tier, number> = { foundation: 0, intermediate: 0, advanced: 0 };
  for (const a of aggs) {
    dist.foundation += a.tierDistribution.foundation;
    dist.intermediate += a.tierDistribution.intermediate;
    dist.advanced += a.tierDistribution.advanced;
  }
  const order: Tier[] = ["foundation", "intermediate", "advanced"];
  let best: Tier = "intermediate";
  let bestN = -1;
  for (const t of order) {
    if (dist[t] > bestN) {
      bestN = dist[t];
      best = t;
    }
  }
  return best;
}

/** 单个知识点的错题上下文（附加到出题 user 消息） */
export function kpContext(a: RemedialKp): string {
  const lines = [
    `本班学生在知识点「${a.code} ${a.name}」上的典型错误（${a.studentCount} 人，${a.wrongCount} 人次）：`,
    ...a.sampleStems.map((s, i) => `错题示例 ${i + 1}：${s}`),
  ];
  if (a.commonErrorTags.length) {
    lines.push(
      `高频错因：${a.commonErrorTags.map((t) => `${t.tag}(${t.count}次)`).join("、")}。`
    );
  }
  lines.push("请针对这些典型错误出变式题，帮助学生突破同类错法。");
  return lines.join("\n");
}
