/**
 * F4 应用内「一键演示」数据生成：
 * - 不依赖 LLM：内置参数化数学模板池（10 个，选择/填空/解答），确定性 rng 实例化；
 *   解答题直接写确定性批改结果（一半待批改、一半部分得分），全程本地判分
 * - 幂等：每次生成先按 source 标记 + 题干预留前缀精确清理，再以固定种子重建；
 *   中途失败再点一次自愈
 * - 数据隔离：演示作业只引用本次新建的模板题目（不碰题库 Question）；
 *   清理时按 assignment → submission/question 可达性删除，
 *   受影响 Mastery.value 回退为剩余 MasteryPoint 中 at 最新值（无则 0.3）
 */
import { Prisma, Role } from "@prisma/client";
import { prisma } from "./prisma";
import { clamp, parseArr, toArrStr } from "./json";
import { avg, tierOf, updateMastery } from "./mastery";

const DEMO_SOURCE = "demo";
const DEMO_STEM_PREFIX = "【演示】";
const ERROR_TAGS = ["计算失误", "概念混淆", "步骤遗漏", "审题错误"];

/** mulberry32 确定性伪随机（固定种子 → 序列可复现） */
function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(rnd: () => number, arr: T[]): T => arr[Math.floor(rnd() * arr.length)];

/** 参数化题目模板：build(rnd) 返回实例化后的题目 */
interface DemoTemplate {
  type: "SINGLE_CHOICE" | "FILL_BLANK" | "OPEN_RESPONSE";
  difficulty: number;
  kpCode: string;
  build: (rnd: () => number) => {
    stem: string;
    options?: string[];
    answer: string;
    analysis: string;
  };
}

const INT = (rnd: () => number, min: number, max: number) =>
  min + Math.floor(rnd() * (max - min + 1));

/** 生成含唯一正确答案的选项并打乱顺序，answer 为正确选项字母 */
function choiceOptions(
  rnd: () => number,
  correct: string,
  distractors: string[]
): { options: string[]; answer: string } {
  const opts = [correct, ...distractors.slice(0, 3)];
  for (let i = opts.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [opts[i], opts[j]] = [opts[j], opts[i]];
  }
  return { options: opts, answer: String.fromCharCode(65 + opts.indexOf(correct)) };
}

const TEMPLATES: DemoTemplate[] = [
  {
    type: "FILL_BLANK",
    difficulty: 1,
    kpCode: "K2",
    build: (rnd) => {
      const a = INT(rnd, -9, 9) || 3;
      const b = INT(rnd, -9, 9);
      const ans = a + b;
      return {
        stem: `${DEMO_STEM_PREFIX}计算：(${a}) + (${b}) = ______。`,
        answer: String(ans),
        analysis: `异号两数相加：${a} + ${b} = ${ans}。`,
      };
    },
  },
  {
    type: "FILL_BLANK",
    difficulty: 2,
    kpCode: "K2",
    build: (rnd) => {
      const a = INT(rnd, 2, 9);
      const b = pick(rnd, [-1, 1]) * INT(rnd, 2, 9);
      const ans = a * b;
      return {
        stem: `${DEMO_STEM_PREFIX}计算：${a} × (${b}) = ______。`,
        answer: String(ans),
        analysis: `两数相乘：${a} × (${b}) = ${ans}。`,
      };
    },
  },
  {
    type: "FILL_BLANK",
    difficulty: 3,
    kpCode: "K2",
    build: (rnd) => {
      const a = INT(rnd, 2, 5);
      const b = INT(rnd, -6, 6);
      const ans = -a * a + b;
      return {
        stem: `${DEMO_STEM_PREFIX}计算：-${a}² + ${b} = ______（注意 -${a}² 表示 ${a}² 的相反数）。`,
        answer: String(ans),
        analysis: `-${a}² = -${a * a}，故原式 = -${a * a} + ${b} = ${ans}。`,
      };
    },
  },
  {
    type: "FILL_BLANK",
    difficulty: 1,
    kpCode: "K4",
    build: (rnd) => {
      const a = pick(rnd, [2, 3, 4, 5, 6, 8]);
      const x = INT(rnd, 2, 9);
      return {
        stem: `${DEMO_STEM_PREFIX}解方程：${a}x = ${a * x}，得 x = ______。`,
        answer: String(x),
        analysis: `两边同时除以 ${a}，得 x = ${x}。`,
      };
    },
  },
  {
    type: "FILL_BLANK",
    difficulty: 2,
    kpCode: "K4",
    build: (rnd) => {
      const a = INT(rnd, 2, 9);
      const x = INT(rnd, 2, 9);
      return {
        stem: `${DEMO_STEM_PREFIX}解方程：x + ${a} = ${a + x}，得 x = ______。`,
        answer: String(x),
        analysis: `移项：x = ${a + x} - ${a} = ${x}。`,
      };
    },
  },
  {
    type: "SINGLE_CHOICE",
    difficulty: 2,
    kpCode: "K3",
    build: (rnd) => {
      const a = INT(rnd, -5, 5) || 2;
      const b = INT(rnd, 1, 9);
      const ans = 2 * a - b;
      const { options, answer } = choiceOptions(rnd, String(ans), [
        String(ans + 1),
        String(ans - 1),
        String(ans + 2),
      ]);
      return {
        stem: `${DEMO_STEM_PREFIX}当 x = ${a} 时，代数式 2x - ${b} 的值是（　）`,
        options,
        answer,
        analysis: `代入：2 × (${a}) - ${b} = ${2 * a} - ${b} = ${ans}。`,
      };
    },
  },
  {
    type: "FILL_BLANK",
    difficulty: 1,
    kpCode: "K3",
    build: (rnd) => {
      const a = INT(rnd, 1, 6);
      const b = INT(rnd, 1, 6);
      const c = INT(rnd, 1, Math.min(a + b - 1, 9));
      const coef = a + b - c;
      return {
        stem: `${DEMO_STEM_PREFIX}化简：${a}x + ${b}x - ${c}x = ______。`,
        answer: coef === 1 ? "x" : `${coef}x`,
        analysis: `合并同类项：(${a} + ${b} - ${c})x = ${coef}x。`,
      };
    },
  },
  {
    type: "SINGLE_CHOICE",
    difficulty: 2,
    kpCode: "K7",
    build: (rnd) => {
      const a = INT(rnd, 20, 70);
      const ans = 90 - a;
      const { options, answer } = choiceOptions(rnd, String(ans), [
        String(ans + 5),
        String(ans - 5),
        String(180 - a),
      ]);
      return {
        stem: `${DEMO_STEM_PREFIX}已知 ∠A = ${a}°，则 ∠A 的余角等于（　）`,
        options,
        answer,
        analysis: `余角 = 90° - ${a}° = ${ans}°。`,
      };
    },
  },
  {
    type: "FILL_BLANK",
    difficulty: 2,
    kpCode: "K5",
    build: (rnd) => {
      const speed = pick(rnd, [40, 50, 60, 80]);
      const hours = INT(rnd, 2, 6);
      return {
        stem: `${DEMO_STEM_PREFIX}一辆汽车以 ${speed} km/h 的速度匀速行驶 ${speed * hours} km，需要 ______ 小时。`,
        answer: String(hours),
        analysis: `设需要 x 小时，${speed}x = ${speed * hours}，x = ${hours}。`,
      };
    },
  },
  {
    type: "OPEN_RESPONSE",
    difficulty: 3,
    kpCode: "K4",
    build: (rnd) => {
      const a = INT(rnd, 2, 5);
      const c = a + INT(rnd, 1, 3);
      const b = INT(rnd, 1, 9);
      const d = b + (a - c) * INT(rnd, 2, 5); // (a-c) 为负，保证 x 为正
      const x = (d - b) / (a - c);
      return {
        stem: `${DEMO_STEM_PREFIX}解方程 ${a}x + ${b} = ${c}x + ${d}，请写出移项、合并与求解的完整过程。`,
        answer: `移项：${a}x - ${c}x = ${d} - ${b}，即 ${a - c}x = ${d - b}，两边除以 ${a - c}，得 x = ${x}。`,
        analysis: `移项得 ${a - c}x = ${d - b}，x = ${x}。注意移项要变号。`,
      };
    },
  },
];

const OPEN_TEMPLATE_IDX = TEMPLATES.length - 1;

/** 清除全部演示数据：按标记与可达性删除，Mastery 回退 */
export async function clearDemoData(): Promise<void> {
  const demoAssignments = await prisma.assignment.findMany({
    where: { source: DEMO_SOURCE },
    select: { id: true },
  });
  const assignmentIds = demoAssignments.map((a) => a.id);
  if (assignmentIds.length) {
    const links = await prisma.assignmentQuestion.findMany({
      where: { assignmentId: { in: assignmentIds } },
      select: { questionId: true },
    });
    const questionIds = links.map((l) => l.questionId);

    await prisma.answerRecord.deleteMany({
      where: { submission: { assignmentId: { in: assignmentIds } } },
    });
    await prisma.wrongQuestion.deleteMany({ where: { questionId: { in: questionIds } } });
    await prisma.submission.deleteMany({ where: { assignmentId: { in: assignmentIds } } });
    await prisma.assignmentQuestion.deleteMany({ where: { assignmentId: { in: assignmentIds } } });
    await prisma.assignment.deleteMany({ where: { id: { in: assignmentIds } } });
  }

  // 题干预留前缀兜底：半途崩溃遗留的孤儿演示题也一并清掉。
  // 放在 if 之外——演示作业已删但题目残留时同样要清。
  // 演示题会出现在题库里（/api/questions 未按前缀过滤），真实作业可能选到它们；
  // 被引用时删除会撞 FK RESTRICT（AssignmentQuestion_questionId_fkey）导致整个 clear 500，
  // 所以只删无人引用的题，被真实作业/作答引用的留下来。
  await prisma.question.deleteMany({
    where: {
      stem: { startsWith: DEMO_STEM_PREFIX },
      assignmentQuestions: { none: {} },
      answerRecords: { none: {} },
      wrongQuestions: { none: {} },
    },
  });

  // 演示掌握度历史点删除 + 受影响 Mastery 回退为剩余最新值（无则 0.3）
  const demoPoints = await prisma.masteryPoint.findMany({
    where: { source: DEMO_SOURCE },
    select: { masteryId: true },
  });
  if (demoPoints.length) {
    const masteryIds = [...new Set(demoPoints.map((p) => p.masteryId))];
    await prisma.masteryPoint.deleteMany({ where: { source: DEMO_SOURCE } });
    // 分批回退：每批 10 条并发。曾因一次性并发 ~270 条查询把共享 Neon Pooled
    // 连接冲垮（Can't reach database server），分小批可稳定通过。
    const CHUNK = 10;
    for (let i = 0; i < masteryIds.length; i += CHUNK) {
      await Promise.all(
        masteryIds.slice(i, i + CHUNK).map(async (masteryId) => {
          const latest = await prisma.masteryPoint.findFirst({
            where: { masteryId },
            orderBy: { at: "desc" },
            select: { value: true },
          });
          await prisma.mastery.update({
            where: { id: masteryId },
            data: { value: latest?.value ?? 0.3 },
          });
        })
      );
    }
  }
}

export interface DemoSummary {
  classes: number;
  classNames: string[];
  assignments: number;
  submissions: number;
  answers: number;
  pendingReview: number;
  /** 演示周期回放时间线：每轮结束时全部班级的平均掌握度（内存态推导） */
  timeline: { label: string; classAvg: number }[];
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * 生成演示教学周期：3 个班 × 5 轮数学作业（近 2.5 周，now-17d ~ now-2d），
 * 逐轮按掌握度推进作答与历史；解答题半待批改半部分得分，供复核队列演示。
 */
export async function generateDemoCycle(opts?: { seed?: number }): Promise<DemoSummary> {
  await clearDemoData();
  const rnd = mulberry32(opts?.seed ?? 20261014);

  const math = await prisma.subject.findUnique({ where: { code: "math" } });
  if (!math) throw new Error("缺少数学科目（code=math），请先执行 seed");
  const kps = await prisma.knowledgePoint.findMany({ where: { subjectId: math.id } });
  const kpByCode = new Map(kps.map((k) => [k.code, k.id]));

  const classes = (
    await prisma.class.findMany({
      include: { students: { where: { role: Role.STUDENT } } },
    })
  )
    .filter((c) => c.students.length > 0)
    .slice(0, 3);
  if (!classes.length) throw new Error("没有可用的班级/学生，请先 seed");

  const now = Date.now();
  const rounds = 5;
  // 回放时间线：每轮结束后全部班级的平均掌握度（跨班累计，结束时求均值）
  const roundSum = new Array(rounds).fill(0) as number[];
  const roundCount = new Array(rounds).fill(0) as number[];

  // ---- 在内存中生成整周期数据 ----
  const questions: Prisma.QuestionCreateManyInput[] = [];
  const assignments: Prisma.AssignmentCreateManyInput[] = [];
  const links: Prisma.AssignmentQuestionCreateManyInput[] = [];
  const submissions: Prisma.SubmissionCreateManyInput[] = [];
  const answers: Prisma.AnswerRecordCreateManyInput[] = [];
  const wrongAgg = new Map<string, { count: number; kpIds: string }>(); // `${studentId}|${questionId}`
  interface PointRow {
    studentId: string;
    kpId: string;
    value: number;
    at: Date;
  }
  const points: PointRow[] = [];
  // 掌握度推进（内存态）：studentId → kpId → value；附带已存在的 Mastery 行 id
  const masteryMap = new Map<string, Map<string, number>>();
  const masteryRowIds = new Map<string, string>(); // `${studentId}|${kpId}` → mastery row id

  for (const cls of classes) {
    const existing = await prisma.mastery.findMany({
      where: { subjectId: math.id, studentId: { in: cls.students.map((s) => s.id) } },
    });
    for (const stu of cls.students) {
      masteryMap.set(stu.id, new Map());
      for (const kp of kps) masteryMap.get(stu.id)!.set(kp.id, 0.3);
    }
    for (const m of existing) {
      masteryMap.get(m.studentId)!.set(m.kpId, m.value);
      masteryRowIds.set(`${m.studentId}|${m.kpId}`, m.id);
    }

    // 本班演示周期内含 2-3 道解答题
    const openRoundIdx = new Set<number>();
    const openCount = 2 + (rnd() < 0.5 ? 1 : 0);
    while (openRoundIdx.size < openCount) openRoundIdx.add(Math.floor(rnd() * rounds));

    for (let r = 0; r < rounds; r++) {
      const roundTime = new Date(now - 17 * DAY + r * 3.75 * DAY);
      const assignmentId = crypto.randomUUID();
      assignments.push({
        id: assignmentId,
        subjectId: math.id,
        classId: cls.id,
        type: "HOMEWORK",
        title: `第 ${r + 1} 周练习`,
        createdAt: roundTime,
        dueAt: new Date(roundTime.getTime() + 3 * DAY),
        source: DEMO_SOURCE,
      });

      // 选题：模板轮换 + 班级偏移；解答题轮次的最后一题用开放模板
      const tierPlan: (string | null)[] = [null, "foundation", "intermediate", "advanced", null];
      const roundQuestions: { q: Prisma.QuestionCreateManyInput; tier: string | null }[] = [];
      for (let qi = 0; qi < 5; qi++) {
        const useOpen = openRoundIdx.has(r) && qi === 4;
        const t = useOpen
          ? TEMPLATES[OPEN_TEMPLATE_IDX]
          : TEMPLATES[(r * 2 + qi + cls.name.length) % OPEN_TEMPLATE_IDX];
        const built = t.build(rnd);
        const kpId = kpByCode.get(t.kpCode);
        const q: Prisma.QuestionCreateManyInput = {
          id: crypto.randomUUID(),
          subjectId: math.id,
          kpIds: toArrStr(kpId ? [kpId] : []),
          type: t.type,
          difficulty: t.difficulty,
          stem: built.stem,
          options: built.options ? toArrStr(built.options) : null,
          answer: built.answer,
          analysis: built.analysis,
        };
        questions.push(q);
        const tier = tierPlan[qi];
        roundQuestions.push({ q, tier });
        links.push({
          assignmentId,
          questionId: q.id as string,
          order: qi + 1,
          tier,
        });
      }

      // 逐生作答
      for (const stu of cls.students) {
        const stuMap = masteryMap.get(stu.id)!;
        const stuTier = tierOf(avg([...stuMap.values()]));
        const visible = roundQuestions.filter(({ tier }) => !tier || tier === stuTier);
        const submissionId = crypto.randomUUID();
        submissions.push({
          id: submissionId,
          assignmentId,
          studentId: stu.id,
          submittedAt: new Date(roundTime.getTime() + 0.5 * DAY + Math.floor(rnd() * 0.9 * DAY)),
        });

        const roundKp = new Map<string, { sum: number; n: number }>();
        for (const { q } of visible) {
          const kpIds = parseArr(q.kpIds as string);
          const kpMastery = Math.max(...kpIds.map((id) => stuMap.get(id) ?? 0.3), 0.1);
          const correct = rnd() < clamp(kpMastery * 0.95, 0.05, 0.98);
          const isOpen = q.type === "OPEN_RESPONSE";
          const qOpts = q.options ? parseArr<string>(q.options as string) : [];

          let response: string;
          if (correct) {
            response = q.answer as string;
          } else if (q.type === "SINGLE_CHOICE") {
            const letters = qOpts
              .map((_, i) => String.fromCharCode(65 + i))
              .filter((l) => l !== q.answer);
            response = pick(rnd, letters.length ? letters : ["A"]);
          } else if (q.type === "FILL_BLANK") {
            const n = Number(q.answer);
            response = Number.isFinite(n) ? String(n + pick(rnd, [-2, -1, 1, 2, 3])) : "不会";
          } else {
            response = pick(rnd, ["不会做", "算不出来", "x = 0", "无解"]);
          }

          // 判分：客观题确定性；解答题直接写结果（一半待批改、一半部分得分）
          let isCorrect: boolean | null;
          let score: number | null;
          let confidence: number | null;
          let reviewStatus: "none" | "needs_review";
          let errorTags: string;
          let errorAnalysis: string | null;
          let improvement: string | null = null;
          if (isOpen) {
            const pending = rnd() < 0.5;
            if (pending) {
              isCorrect = null;
              score = null;
              confidence = null;
              reviewStatus = "needs_review";
              errorTags = "[]";
              errorAnalysis = null;
            } else {
              isCorrect = false;
              score = Math.round((0.5 + rnd() * 0.2) * 10) / 10;
              confidence = Math.round((0.45 + rnd() * 0.2) * 100) / 100;
              reviewStatus = "needs_review";
              errorTags = toArrStr([pick(rnd, ERROR_TAGS)]);
              errorAnalysis = "演示：解答过程不完整，待教师复核。";
              improvement = "演示：建议补全移项与合并同类项步骤。";
            }
          } else {
            isCorrect = correct;
            score = correct ? 1 : 0;
            confidence = 1;
            reviewStatus = "none";
            errorTags = correct ? "[]" : toArrStr([pick(rnd, ERROR_TAGS)]);
            errorAnalysis = correct ? null : (q.analysis as string | null);
          }

          answers.push({
            submissionId,
            questionId: q.id as string,
            kpIds: q.kpIds as string,
            studentId: stu.id,
            response,
            isCorrect,
            score,
            timeSpentMs: 20_000 + Math.floor(rnd() * 280_000),
            errorTags,
            errorAnalysis,
            improvement,
            confidence,
            reviewStatus,
          });

          if (isCorrect === false || (score != null && score < 0.6)) {
            const key = `${stu.id}|${q.id}`;
            const cur = wrongAgg.get(key);
            wrongAgg.set(key, { count: (cur?.count ?? 0) + 1, kpIds: q.kpIds as string });
          }
          if (score != null) {
            for (const kpId of kpIds) {
              const e = roundKp.get(kpId) ?? { sum: 0, n: 0 };
              e.sum += score;
              e.n += 1;
              roundKp.set(kpId, e);
            }
          }
        }

        // 本轮结束后推进该生掌握度并记录历史点
        for (const [kpId, { sum, n }] of roundKp) {
          const prev = stuMap.get(kpId) ?? 0.3;
          const next = updateMastery(prev, sum / n);
          stuMap.set(kpId, next);
          points.push({ studentId: stu.id, kpId, value: next, at: new Date(roundTime.getTime() + DAY) });
        }
        // 回放时间线累计：该生本轮结束后的平均掌握度
        roundSum[r] += avg([...stuMap.values()]);
        roundCount[r] += 1;
      }
    }
  }

  // ---- 批量写入 ----
  await prisma.question.createMany({ data: questions });
  await prisma.assignment.createMany({ data: assignments });
  await prisma.assignmentQuestion.createMany({ data: links });
  await prisma.submission.createMany({ data: submissions });
  await prisma.answerRecord.createMany({ data: answers });

  // 错题本（约 30% mastered:true，驱动「攻克之星」徽章）
  const wrongRows: Prisma.WrongQuestionCreateManyInput[] = [];
  for (const [key, { count, kpIds }] of wrongAgg) {
    const [studentId, questionId] = key.split("|");
    wrongRows.push({
      studentId,
      questionId,
      kpIds,
      wrongCount: count,
      mastered: rnd() < 0.3,
      lastWrongAt: new Date(now - Math.floor(rnd() * 10) * DAY),
    });
  }
  if (wrongRows.length) {
    await prisma.wrongQuestion.createMany({ data: wrongRows, skipDuplicates: true });
  }

  // Mastery 行：本轮新建的（此前无行）用显式 id 一次 createMany，再写历史点
  const needKeys = [...new Set(points.map((p) => `${p.studentId}|${p.kpId}`))].filter(
    (k) => !masteryRowIds.has(k)
  );
  if (needKeys.length) {
    await prisma.mastery.createMany({
      data: needKeys.map((k) => {
        const [studentId, kpId] = k.split("|");
        const id = crypto.randomUUID();
        masteryRowIds.set(k, id);
        return {
          id,
          studentId,
          kpId,
          subjectId: math.id,
          value: masteryMap.get(studentId)!.get(kpId) ?? 0.3,
        };
      }),
    });
  }
  await prisma.masteryPoint.createMany({
    data: points.map((p) => ({
      masteryId: masteryRowIds.get(`${p.studentId}|${p.kpId}`)!,
      value: p.value,
      at: p.at,
      source: DEMO_SOURCE,
    })),
  });

  return {
    classes: classes.length,
    classNames: classes.map((c) => c.name),
    assignments: assignments.length,
    submissions: submissions.length,
    answers: answers.length,
    pendingReview: answers.filter((a) => a.reviewStatus === "needs_review").length,
    timeline: roundSum.map((s, i) => ({
      label: `第 ${i + 1} 周`,
      classAvg: roundCount[i] ? s / roundCount[i] : 0,
    })),
  };
}
