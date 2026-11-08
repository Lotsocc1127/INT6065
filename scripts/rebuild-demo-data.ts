/**
 * 重建一套「贴合当前时间、覆盖全功能」的演示数据。
 *
 * 保留：账号、班级、科目、知识点、题库（Question）。
 * 重建：作业、提交、作答、掌握度/历史点、错题本、学习目标/申诉、通知、家长分享链接、分层锁定。
 *
 * 覆盖：
 * - 3 个班 × 数学 5 轮（复用 lib/demo.ts 的 generateDemoCycle，近 17 天）
 * - 语文/英语各 2 次小测（近 9 天，choice/fill，含错题与掌握度推进）
 * - 本周数学作业：每班 20/30 人提交，留 10 人待完成（陈静有 pending task）
 * - 分层作业：2 道公共题 + 基础/提升/拓展各 1 道（不再出现"整份 1 题"）
 * - 待复核：解答题待批改/低置信度（applyReview 队列有内容）
 * - 目标申诉：李明（3 班，张老师可见）、周雅静（1 班，王老师可见）
 * - 分层升降：5 名学生设置 tierOverride 且与自动分层不一致
 * - 通知：教师端申诉/提交、学生端新作业/已批改
 * - 家长分享：陈静 1 条有效链接、吴桐 1 条已撤销
 * - 成长徽章：陈静 4/4（≥3 次提交、一次满分、2 道错题已攻克、掌握度提升 ≥10 点）
 *
 * 安全：
 * - 默认 dry-run；`--apply` 才写库。
 * - 写库前把现有活动数据 + 账号绑定备份到 /tmp/zhixue-demo-backup-*.json。
 * - 只删活动表，不删 User/Class/Subject/KnowledgePoint/Question。
 * - 不使用 seed --force / db push。
 *
 * 用法：
 *   npx tsx --env-file=.env scripts/rebuild-demo-data.ts
 *   npx tsx --env-file=.env scripts/rebuild-demo-data.ts --apply
 */
import crypto from "node:crypto";
import fs from "node:fs";
import { AssignmentType, Prisma, PrismaClient, QuestionType, Role, AppealStatus } from "@prisma/client";
import { parseArr, toArrStr } from "../lib/json";
import { avg, tierOf, updateMastery, type Tier } from "../lib/mastery";
import { generateShareToken, hashShareToken } from "../lib/share";
import { resolveChoiceLetter } from "../lib/utils";

const p = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const at = (daysFromNow: number) => new Date(now + daysFromNow * DAY);

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261108);
const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

const ERROR_TAGS: Record<string, string[]> = {
  math: ["计算失误", "概念混淆", "步骤遗漏", "审题错误"],
  english: ["词汇错误", "语法错误", "审题不清", "表达不当"],
  chinese: ["理解偏差", "要点遗漏", "表达不当", "审题不清"],
};

async function createManyInChunks<T>(rows: T[], run: (chunk: T[]) => Promise<unknown>, size = 500) {
  for (let i = 0; i < rows.length; i += size) {
    await run(rows.slice(i, i + size));
  }
}

async function flushMasteries(rows: { id: string; value: number }[]) {
  for (let i = 0; i < rows.length; i += 300) {
    const chunk = rows.slice(i, i + 300);
    if (!chunk.length) continue;
    const values = Prisma.join(
      chunk.map((r) => Prisma.sql`(${r.id}::text, ${r.value}::double precision)`)
    );
    await p.$executeRaw`
      UPDATE "Mastery" AS m
      SET value = v.value, "updatedAt" = NOW()
      FROM (VALUES ${values}) AS v(id, value)
      WHERE m.id = v.id
    `;
  }
}

async function backup() {
  const [
    users, assignments, assignmentQuestions, submissions, answerRecords,
    masteries, masteryPoints, wrongQuestions, learningGoals, notifications, shareLinks,
  ] = await Promise.all([
    p.user.findMany({ select: { id: true, name: true, role: true, classId: true, tierOverride: true } }),
    p.assignment.findMany(),
    p.assignmentQuestion.findMany(),
    p.submission.findMany(),
    p.answerRecord.findMany(),
    p.mastery.findMany(),
    p.masteryPoint.findMany(),
    p.wrongQuestion.findMany(),
    p.learningGoal.findMany(),
    p.notification.findMany(),
    p.shareLink.findMany(),
  ]);
  const file = `/tmp/zhixue-demo-backup-${Date.now()}.json`;
  fs.writeFileSync(
    file,
    JSON.stringify(
      { createdAt: new Date().toISOString(), users, assignments, assignmentQuestions, submissions, answerRecords, masteries, masteryPoints, wrongQuestions, learningGoals, notifications, shareLinks },
      null,
      2
    )
  );
  return file;
}

async function main() {
  const [classes, subjects, questionsRaw, students] = await Promise.all([
    p.class.findMany({ include: { students: { where: { role: Role.STUDENT }, orderBy: { name: "asc" } } }, orderBy: { name: "asc" } }),
    p.subject.findMany({ orderBy: { code: "asc" } }),
    p.question.findMany(),
    p.user.findMany({ where: { role: Role.STUDENT }, orderBy: { name: "asc" } }),
  ]);
  // 上一次演示周期留下的题（前缀）会在清空时被删，这里必须从内存池里排除
  const questions = questionsRaw.filter((q) => !q.stem.startsWith("【演示】"));
  const byCode = new Map(subjects.map((s) => [s.code, s]));
  const math = byCode.get("math");
  const english = byCode.get("english");
  const chinese = byCode.get("chinese");
  if (!math || !english || !chinese) throw new Error("缺少数学/英语/语文科目");
  if (classes.some((c) => c.students.length === 0)) throw new Error("存在空班级");

  const kps = await p.knowledgePoint.findMany();
  const kpById = new Map(kps.map((k) => [k.id, k]));

  // 用现有掌握度作为每个学生/科目的起点（写库前读）
  const oldMasteries = await p.mastery.findMany({ select: { studentId: true, subjectId: true, value: true } });
  const baseAvg = new Map<string, number>();
  {
    const buckets = new Map<string, number[]>();
    for (const m of oldMasteries) {
      const k = `${m.studentId}|${m.subjectId}`;
      const list = buckets.get(k) ?? [];
      list.push(m.value);
      buckets.set(k, list);
    }
    for (const [k, vals] of buckets) baseAvg.set(k, avg(vals));
  }
  const studentBase = (studentId: string, subjectId: string) =>
    baseAvg.get(`${studentId}|${subjectId}`) ?? 0.55;

  const counts = {
    classes: classes.length,
    students: students.length,
    mathAssignments: classes.length * 5,
    chineseAssignments: classes.length * 2,
    englishAssignments: classes.length * 2,
    currentMath: classes.length,
    questions: questions.length,
  };
  console.log("计划：", counts);

  // 预检：题池与关键学生是否存在（避免清空后才发现缺数据）
  const pre = (subjectId: string, type: QuestionType) =>
    questions.filter((q) => q.subjectId === subjectId && q.type === type).length;
  const preflight: [string, number, number][] = [
    ["数学选择题", pre(math.id, QuestionType.SINGLE_CHOICE), 2],
    ["数学填空题", pre(math.id, QuestionType.FILL_BLANK), 2],
    ["数学解答题", pre(math.id, QuestionType.OPEN_RESPONSE), 1],
    ["语文选择题", pre(chinese.id, QuestionType.SINGLE_CHOICE), 5],
    ["英语选择题", pre(english.id, QuestionType.SINGLE_CHOICE), 3],
    ["英语填空题", pre(english.id, QuestionType.FILL_BLANK), 2],
  ];
  for (const [name, got, need] of preflight) {
    if (got < need) throw new Error(`题池不足：${name} 需要 ${need} 道，实际 ${got} 道`);
  }
  for (const className of ["七年级(1)班", "七年级(3)班"]) {
    if (!classes.some((c) => c.name === className)) throw new Error(`缺少班级：${className}`);
  }
  const c3 = classes.find((c) => c.name === "七年级(3)班")!;
  const c1 = classes.find((c) => c.name === "七年级(1)班")!;
  for (const name of ["陈静", "李明", "吴桐", "周明轩"]) {
    if (!c3.students.some((s) => s.name === name)) throw new Error(`3 班缺少学生：${name}`);
  }
  for (const name of ["周雅静", "李梓萱"]) {
    if (!c1.students.some((s) => s.name === name)) throw new Error(`1 班缺少学生：${name}`);
  }

  if (!APPLY) {
    console.log(
      "\n当前是 dry-run，未写库。执行：\n" +
        "  npx tsx --env-file=.env scripts/rebuild-demo-data.ts --apply\n" +
        "会先备份到 /tmp/zhixue-demo-backup-*.json，再重建活动数据。"
    );
    return;
  }

  const backupFile = await backup();
  console.log("已备份：", backupFile);

  // ---- 清空活动数据（保留账号/班级/科目/知识点/题库） ----
  await p.$transaction([
    p.answerRecord.deleteMany(),
    p.wrongQuestion.deleteMany(),
    p.masteryPoint.deleteMany(),
    p.mastery.deleteMany(),
    p.submission.deleteMany(),
    p.assignmentQuestion.deleteMany(),
    p.assignment.deleteMany(),
    p.learningGoal.deleteMany(),
    p.notification.deleteMany(),
    p.shareLink.deleteMany(),
  ]);
  await p.question.deleteMany({ where: { stem: { startsWith: "【演示】" } } });
  await p.user.updateMany({ data: { tierOverride: null } });
  console.log("已清空活动数据（账号/班级/题库保留）");

  // ---- 初始掌握度 + 三周前的历史点 ----
  // 知识点难度画像：同一科目内制造"强弱差"，避免 8 个点全挤在 60% 附近。
  const KP_PROFILE: Record<string, Record<string, number>> = {
    math: { K1: 0.76, K2: 0.72, K3: 0.68, K4: 0.66, K5: 0.56, K6: 0.74, K7: 0.70, K8: 0.60 },
    chinese: { C1: 0.74, C2: 0.68, C3: 0.64, C4: 0.60, C5: 0.56, C6: 0.66, C7: 0.62, C8: 0.58 },
    english: { E1: 0.70, E2: 0.62, E3: 0.66, E4: 0.58, E5: 0.72, E6: 0.60, E7: 0.64, E8: 0.56 },
  };
  const masteryRows: Prisma.MasteryCreateManyInput[] = [];
  const initialPoints: Prisma.MasteryPointCreateManyInput[] = [];
  for (const stu of students) {
    for (const subject of subjects) {
      const subjectKps = kps.filter((k) => k.subjectId === subject.id);
      const base = studentBase(stu.id, subject.id);
      const isChen = stu.name === "陈静";
      const profile = KP_PROFILE[subject.code] ?? {};
      for (const kp of subjectKps) {
        const kpBase = profile[kp.code] ?? 0.65;
        // 学生整体水平（旧数据均值）相对 0.63 的偏移，叠加知识点难度与小幅抖动
        const value = clamp(kpBase + (base - 0.63) * 0.8 + (rnd() - 0.5) * 0.12, 0.12, 0.94);
        const id = crypto.randomUUID();
        const drop = isChen ? 0.2 : 0.06;
        const start = clamp(value - drop, 0.05, 0.95);
        const mid = clamp(value - drop / 2, 0.05, 0.95);
        const late = clamp(value - drop / 4, 0.05, 0.95);
        masteryRows.push({ id, studentId: stu.id, kpId: kp.id, subjectId: subject.id, value: late });
        initialPoints.push(
          { masteryId: id, value: start, at: at(-24), source: "seed" },
          { masteryId: id, value: mid, at: at(-21), source: "seed" },
          { masteryId: id, value: late, at: at(-18), source: "seed" }
        );
      }
    }
  }
  await createManyInChunks(masteryRows, (chunk) => p.mastery.createMany({ data: chunk }), 500);
  await createManyInChunks(initialPoints, (chunk) => p.masteryPoint.createMany({ data: chunk }), 1000);
  console.log(`初始掌握度：${masteryRows.length} 行 / ${initialPoints.length} 个历史点`);

  // ---- 加载初始掌握度（下面用真实题库自己生成 5 轮数学，避免【演示】前缀泄漏） ----
  const masteryMap = new Map<string, number>(); // `${studentId}|${kpId}`
  const masteryId = new Map<string, string>();
  {
    const rows = await p.mastery.findMany({ select: { id: true, studentId: true, kpId: true, value: true } });
    for (const m of rows) {
      masteryMap.set(`${m.studentId}|${m.kpId}`, m.value);
      masteryId.set(`${m.studentId}|${m.kpId}`, m.id);
    }
  }

  // ---- 题池 ----
  const pool = (subjectId: string, type: QuestionType) =>
    questions.filter((q) => q.subjectId === subjectId && q.type === type);
  const mathChoice = pool(math.id, QuestionType.SINGLE_CHOICE);
  const mathFill = pool(math.id, QuestionType.FILL_BLANK);
  const mathOpen = pool(math.id, QuestionType.OPEN_RESPONSE);
  const chiChoice = pool(chinese.id, QuestionType.SINGLE_CHOICE);
  const engChoice = pool(english.id, QuestionType.SINGLE_CHOICE);
  const engFill = pool(english.id, QuestionType.FILL_BLANK);
  if (mathChoice.length < 2 || mathFill.length < 2 || mathOpen.length < 1) throw new Error("数学题库不足");
  if (chiChoice.length < 5) throw new Error("语文选择题不足");
  if (engChoice.length < 3 || engFill.length < 2) throw new Error("英语题库不足");

  const take = <T,>(list: T[], n: number, offset: number): T[] => {
    const out: T[] = [];
    for (let i = 0; i < n; i++) out.push(list[(offset + i) % list.length]);
    return out;
  };

  const dirty = new Set<string>();
  const points: Prisma.MasteryPointCreateManyInput[] = [];
  const wrongAgg = new Map<string, { studentId: string; questionId: string; kpIds: string; count: number; lastWrongAt: Date }>();
  const submissions: Prisma.SubmissionCreateManyInput[] = [];
  const answers: Prisma.AnswerRecordCreateManyInput[] = [];

  function masteryValue(studentId: string, kpId: string) {
    return masteryMap.get(`${studentId}|${kpId}`) ?? 0.3;
  }
  function setMastery(studentId: string, kpId: string, value: number) {
    masteryMap.set(`${studentId}|${kpId}`, value);
    dirty.add(`${studentId}|${kpId}`);
  }

  interface QWithTier {
    q: (typeof questions)[number];
    tier: string | null;
    order: number;
  }

  async function createAssignment(opts: {
    subjectId: string;
    classId: string;
    title: string;
    type: AssignmentType;
    createdAt: Date;
    dueAt: Date;
    questions: QWithTier[];
    submitStudents: typeof students;
    forceAllCorrect?: (studentName: string) => boolean;
  }): Promise<string> {
    const id = crypto.randomUUID();
    await p.assignment.create({
      data: {
        id,
        subjectId: opts.subjectId,
        classId: opts.classId,
        type: opts.type,
        title: opts.title,
        createdAt: opts.createdAt,
        dueAt: opts.dueAt,
        source: "demo",
        questions: {
          create: opts.questions.map((x) => ({ questionId: x.q.id, order: x.order, tier: x.tier })),
        },
      },
    });

    for (const stu of opts.submitStudents) {
      const submittedAt = new Date(
        Math.min(opts.createdAt.getTime() + (0.3 + rnd() * 0.5) * DAY, now - 2 * 60 * 60 * 1000)
      );
      const sid = crypto.randomUUID();
      submissions.push({ id: sid, assignmentId: id, studentId: stu.id, submittedAt });

      // 分层：用该生该科平均判断层级
      const subjectKps = kps.filter((k) => k.subjectId === opts.subjectId);
      const stuAvg = subjectKps.length
        ? avg(subjectKps.map((k) => masteryValue(stu.id, k.id)))
        : 0.3;
      const stuTier = tierOf(stuAvg);
      const visibleRows = opts.questions.filter((x) => !x.tier || x.tier === stuTier);

      const kpRate = new Map<string, { sum: number; n: number }>();
      for (const { q } of visibleRows) {
        const kpIds = parseArr<string>(q.kpIds);
        const qOpts = parseArr<string>(q.options);
        const qType = q.type;
        const kpMastery = Math.max(...kpIds.map((id2) => masteryValue(stu.id, id2)), 0.05);
        const force = opts.forceAllCorrect?.(stu.name) ?? false;
        const correct = force || rnd() < clamp(kpMastery * 0.9 + 0.1, 0.05, 0.99);

        let response = "";
        let isCorrect: boolean | null = true;
        let score: number | null = 1;
        let confidence: number | null = 1;
        let reviewStatus = "none";
        let errorTags: string[] = [];
        let errorAnalysis: string | null = null;

        if (qType === QuestionType.SINGLE_CHOICE) {
          const expected = resolveChoiceLetter(qOpts, q.answer);
          if (correct) response = expected;
          else {
            const letters = "ABCD".slice(0, qOpts.length).split("").filter((l) => l !== expected);
            response = letters.length ? pick(letters) : "（空）";
          }
          isCorrect = correct;
          score = correct ? 1 : 0;
          if (!correct) {
            errorTags = [pick(ERROR_TAGS[subjects.find((s) => s.id === opts.subjectId)!.code] ?? ERROR_TAGS.math)];
            errorAnalysis = q.analysis ?? "作答与标准答案不一致。";
          }
        } else if (qType === QuestionType.FILL_BLANK) {
          if (correct) response = q.answer.split("|")[0].trim();
          else {
            const n = Number(q.answer.split("|")[0]);
            response = Number.isFinite(n) ? String(n + pick([-3, -2, -1, 1, 2, 3])) : "（空）";
          }
          isCorrect = correct;
          score = correct ? 1 : 0;
          if (!correct) {
            errorTags = [pick(ERROR_TAGS[subjects.find((s) => s.id === opts.subjectId)!.code] ?? ERROR_TAGS.math)];
            errorAnalysis = q.analysis ?? "作答与标准答案不一致。";
          }
        } else {
          // 解答题：一半待批改、一半部分得分（都进复核队列）
          const pending = rnd() < 0.5;
          response = pending ? "（未完成，待批改）" : "解：设未知数后列出方程，移项、合并同类项，最后系数化为 1。";
          isCorrect = pending ? null : false;
          score = pending ? null : Math.round((0.5 + rnd() * 0.2) * 10) / 10;
          confidence = pending ? null : Math.round((0.5 + rnd() * 0.15) * 100) / 100;
          reviewStatus = "needs_review";
          errorTags = pending ? [] : [pick(ERROR_TAGS.math)];
          errorAnalysis = pending ? null : "解答步骤不完整，待教师复核。";
        }

        answers.push({
          submissionId: sid,
          questionId: q.id,
          kpIds: q.kpIds,
          studentId: stu.id,
          response,
          isCorrect,
          score,
          timeSpentMs: 20_000 + Math.floor(rnd() * 220_000),
          errorTags: toArrStr(errorTags),
          errorAnalysis,
          improvement: null,
          confidence,
          reviewStatus,
        });

        if (score != null) {
          for (const kpId of kpIds) {
            const e = kpRate.get(kpId) ?? { sum: 0, n: 0 };
            e.sum += score;
            e.n += 1;
            kpRate.set(kpId, e);
          }
        }
        if (isCorrect === false || (score != null && score < 0.6)) {
          const key = `${stu.id}|${q.id}`;
          const cur = wrongAgg.get(key);
          wrongAgg.set(key, {
            studentId: stu.id,
            questionId: q.id,
            kpIds: q.kpIds,
            count: (cur?.count ?? 0) + 1,
            lastWrongAt: submittedAt,
          });
        }
      }

      for (const [kpId, { sum, n }] of kpRate) {
        const prev = masteryValue(stu.id, kpId);
        const next = updateMastery(prev, sum / n);
        setMastery(stu.id, kpId, next);
        const mid = masteryId.get(`${stu.id}|${kpId}`);
        if (mid) points.push({ masteryId: mid, value: next, at: submittedAt, source: "demo" });
      }
    }
    return id;
  }

  // ---- 语文/英语各 2 次小测 + 本周数学 ----
  for (const [ci, cls] of classes.entries()) {
    const all = cls.students;

    // 数学 5 轮（近 17 天）：2 公共 + 基础/提升/拓展；解答题按轮次穿插，供复核
    for (let r = 0; r < 5; r++) {
      const createdAt = at(-17 + r * 3.75);
      const openRound = r % 2 === 0;
      const questions: QWithTier[] = [
        { q: take(mathChoice, 1, ci * 3 + r)[0], tier: null, order: 1 },
        { q: take(mathFill, 1, ci + r)[0], tier: null, order: 2 },
        { q: take(mathFill, 1, ci + r + 3)[0], tier: "foundation", order: 3 },
        { q: openRound ? take(mathOpen, 1, ci + r)[0] : take(mathFill, 1, ci + r + 6)[0], tier: "intermediate", order: 4 },
        { q: openRound ? take(mathOpen, 1, ci + r + 1)[0] : take(mathFill, 1, ci + r + 9)[0], tier: "advanced", order: 5 },
      ];
      await createAssignment({
        subjectId: math.id,
        classId: cls.id,
        title: `第 ${r + 1} 周练习`,
        type: AssignmentType.HOMEWORK,
        createdAt,
        dueAt: new Date(createdAt.getTime() + 3 * DAY),
        questions,
        submitStudents: all,
      });
    }

    await createAssignment({
      subjectId: chinese.id,
      classId: cls.id,
      title: "语文基础 · 近两周小测",
      type: AssignmentType.QUIZ,
      createdAt: at(-9),
      dueAt: at(-6),
      questions: take(chiChoice, 5, ci * 2).map((q, i) => ({ q, tier: null, order: i + 1 })),
      submitStudents: all,
    });

    await createAssignment({
      subjectId: english.id,
      classId: cls.id,
      title: "一般现在时 · 单元小测",
      type: AssignmentType.QUIZ,
      createdAt: at(-8),
      dueAt: at(-5),
      questions: [
        ...take(engChoice, 3, ci * 2).map((q, i) => ({ q, tier: null, order: i + 1 })),
        ...take(engFill, 2, ci * 2).map((q, i) => ({ q, tier: null, order: i + 4 })),
      ],
      submitStudents: all,
    });

    // 英语第二次：陈静全对（满分之星）
    await createAssignment({
      subjectId: english.id,
      classId: cls.id,
      title: "词汇与句型 · 本周练习",
      type: AssignmentType.HOMEWORK,
      createdAt: at(-4),
      dueAt: at(-1),
      questions: [
        ...take(engChoice, 3, ci * 2 + 1).map((q, i) => ({ q, tier: null, order: i + 1 })),
        ...take(engFill, 2, ci * 2 + 1).map((q, i) => ({ q, tier: null, order: i + 4 })),
      ],
      submitStudents: all,
      forceAllCorrect: (name) => name === "陈静",
    });

    await createAssignment({
      subjectId: chinese.id,
      classId: cls.id,
      title: "语文基础 · 本周小测",
      type: AssignmentType.QUIZ,
      createdAt: at(-3),
      dueAt: at(1),
      questions: take(chiChoice, 5, ci * 2 + 1).map((q, i) => ({ q, tier: null, order: i + 1 })),
      submitStudents: all,
    });

    // 错题订正小测（3 题全对 → 陈静拿到"满分之星"；所有班都有，覆盖满分记录）
    await createAssignment({
      subjectId: math.id,
      classId: cls.id,
      title: "错题订正 · 小测",
      type: AssignmentType.HOMEWORK,
      createdAt: at(-2),
      dueAt: at(-1),
      questions: [
        ...take(mathChoice, 2, ci * 2 + 1).map((q, i) => ({ q, tier: null, order: i + 1 })),
        { q: take(mathFill, 1, ci * 2 + 1)[0], tier: null, order: 3 },
      ],
      submitStudents: all,
      forceAllCorrect: (name) => cls.name === "七年级(3)班" && name === "陈静",
    });

    // 本周数学：2 公共 + 基础/提升/拓展；留 10 人未交（含陈静）
    const currentQuestions: QWithTier[] = [
      { q: take(mathChoice, 2, ci * 2)[0], tier: null, order: 1 },
      { q: take(mathFill, 2, ci * 2)[0], tier: null, order: 2 },
      { q: take(mathFill, 2, ci * 2)[1], tier: "foundation", order: 3 },
      { q: take(mathFill, 4, ci * 2 + 2)[2], tier: "intermediate", order: 4 },
      { q: take(mathOpen, 1, ci)[0], tier: "advanced", order: 5 },
    ];
    const submit = all
      .filter((s) => !(cls.name === "七年级(3)班" && s.name === "陈静"))
      .slice(0, 20);
    await createAssignment({
      subjectId: math.id,
      classId: cls.id,
      title: "一元一次方程 · 本周作业",
      type: AssignmentType.HOMEWORK,
      createdAt: at(-1),
      dueAt: at(3),
      questions: currentQuestions,
      submitStudents: submit,
    });
  }

  // ---- 批量写提交/作答/历史点 ----
  await createManyInChunks(submissions, (chunk) => p.submission.createMany({ data: chunk }), 500);
  await createManyInChunks(answers, (chunk) => p.answerRecord.createMany({ data: chunk }), 500);
  await createManyInChunks(points, (chunk) => p.masteryPoint.createMany({ data: chunk }), 1000);
  await flushMasteries([...dirty].map((k) => {
    const [studentId, kpId] = k.split("|");
    return { id: masteryId.get(k)!, value: masteryValue(studentId, kpId) };
  }));
  console.log(`提交 ${submissions.length} 条 / 作答 ${answers.length} 条 / 历史点 ${points.length} 个`);

  // ---- 错题本 ----
  const wrongRows: Prisma.WrongQuestionCreateManyInput[] = [];
  for (const [key, w] of wrongAgg) {
    const [studentId] = key.split("|");
    wrongRows.push({
      studentId,
      questionId: w.questionId,
      kpIds: w.kpIds,
      wrongCount: w.count,
      mastered: rnd() < 0.3,
      lastWrongAt: w.lastWrongAt,
    });
  }
  await createManyInChunks(wrongRows, (chunk) => p.wrongQuestion.createMany({ data: chunk }), 500);

  // 陈静保证 2 道错题已攻克（攻克之星）
  {
    const chen = students.find((s) => s.name === "陈静");
    if (chen) {
      const list = await p.wrongQuestion.findMany({
        where: { studentId: chen.id, mastered: false, question: { subjectId: math.id } },
        take: 2,
      });
      for (const w of list) await p.wrongQuestion.update({ where: { id: w.id }, data: { mastered: true } });
    }
  }

  // ---- 学习目标 + 待复核申诉 ----
  const class3 = classes.find((c) => c.name === "七年级(3)班")!;
  const class1 = classes.find((c) => c.name === "七年级(1)班")!;
  const goalRows: Prisma.LearningGoalCreateManyInput[] = [];
  for (const stu of students) {
    const kp = kps
      .filter((k) => k.subjectId === math.id)
      .sort((a, b) => masteryValue(stu.id, a.id) - masteryValue(stu.id, b.id))[0];
    const content = [
      `掌握${kp.code} ${kp.name}，本周正确率达到 80%`,
      `本周每天完成 5 道${kp.name}练习`,
      `整理${kp.name}错题并重做`,
    ][Math.floor(rnd() * 3)];
    const isLi = stu.name === "李明" && stu.classId === class3.id;
    const isZhou = stu.name === "周雅静" && stu.classId === class1.id;
    goalRows.push({
      studentId: stu.id,
      content: isLi ? "掌握去分母的方法，测验正确率达到 80%" : isZhou ? "本周每天完成 5 道解方程练习" : content,
      kpId: kp.id,
      done: !isLi && !isZhou && rnd() < 0.2,
      appealStatus: isLi || isZhou ? AppealStatus.PENDING : AppealStatus.NONE,
      appealReason: isLi
        ? "我觉得已经掌握了这部分内容，这个目标对我的帮助不大，希望老师帮我调整。"
        : isZhou
          ? "最近作业太多，想把这个目标改成每天 3 道题。"
          : null,
      appealRequestedAt: isLi ? at(-2) : isZhou ? at(-1) : null,
      createdAt: at(-12 + Math.floor(rnd() * 8)),
    });
  }
  await createManyInChunks(goalRows, (chunk) => p.learningGoal.createMany({ data: chunk }), 500);

  // ---- 分层锁定（制造 5 个升降候选） ----
  const overrides: [string, string, string][] = [
    ["七年级(3)班", "李明", "intermediate"],
    ["七年级(3)班", "吴桐", "intermediate"],
    ["七年级(3)班", "周明轩", "foundation"],
    ["七年级(1)班", "周雅静", "intermediate"],
    ["七年级(1)班", "李梓萱", "intermediate"],
  ];
  for (const [className, name, tier] of overrides) {
    const cls = classes.find((c) => c.name === className);
    const stu = cls?.students.find((s) => s.name === name);
    if (stu) await p.user.update({ where: { id: stu.id }, data: { tierOverride: tier } });
  }

  // ---- 通知 ----
  const teacher = await p.user.findFirst({ where: { role: Role.TEACHER, name: "张老师" } });
  const teacher1 = await p.user.findFirst({ where: { role: Role.TEACHER, name: "王老师" } });
  const chen = class3.students.find((s) => s.name === "陈静")!;
  const li = class3.students.find((s) => s.name === "李明")!;
  const zhou = class1.students.find((s) => s.name === "周雅静")!;
  const chenCls = class3;
  const current = await p.assignment.findFirst({
    where: { classId: chenCls.id, title: "一元一次方程 · 本周作业" },
    select: { id: true },
  });
  const notifRows: Prisma.NotificationCreateManyInput[] = [];
  if (teacher) {
    notifRows.push(
      { userId: teacher.id, type: "appeal_filed", title: "李明提交了学习目标申诉", body: "「掌握去分母的方法，测验正确率达到 80%」等待复核", link: "/teacher/review", createdAt: at(-2), readAt: null },
      { userId: teacher.id, type: "submission", title: "陈静提交了《一元一次方程 · 本周作业》", body: "客观题已自动批改，解答题待复核", link: current ? `/teacher/assignments/${current.id}` : "/teacher/assignments", createdAt: at(-1), readAt: null },
      { userId: teacher.id, type: "submission", title: "李明提交了《一元一次方程 · 本周作业》", body: "有解答题需要复核", link: current ? `/teacher/assignments/${current.id}` : "/teacher/assignments", createdAt: at(-1), readAt: at(-0.5) }
    );
  }
  if (teacher1) {
    notifRows.push(
      { userId: teacher1.id, type: "appeal_filed", title: "周雅静提交了学习目标申诉", body: "「本周每天完成 5 道解方程练习」等待复核", link: "/teacher/review", createdAt: at(-1), readAt: null },
      { userId: teacher1.id, type: "submission", title: "周雅静提交了作业", body: "点击查看批改", link: "/teacher/assignments", createdAt: at(-1), readAt: null }
    );
  }
  notifRows.push(
    { userId: chen.id, type: "assignment", title: "新作业：一元一次方程 · 本周作业", body: "截止时间还有 3 天", link: current ? `/student/assignments/${current.id}` : "/student", createdAt: at(-1), readAt: null },
    { userId: chen.id, type: "reviewed", title: "你的《词汇与句型 · 本周练习》已批改", body: "本次满分，继续保持", link: "/student/growth", createdAt: at(-2), readAt: at(-1) },
    { userId: li.id, type: "assignment", title: "新作业：一元一次方程 · 本周作业", body: "截止时间还有 3 天", link: current ? `/student/assignments/${current.id}` : "/student", createdAt: at(-1), readAt: null },
    { userId: li.id, type: "appeal_resolved", title: "申诉已提交", body: "等待老师复核", link: "/student/goals", createdAt: at(-2), readAt: null },
    { userId: zhou.id, type: "appeal_resolved", title: "申诉已提交", body: "等待老师复核", link: "/student/goals", createdAt: at(-1), readAt: null }
  );
  await p.notification.createMany({ data: notifRows });

  // ---- 家长分享链接 ----
  const shareToken = generateShareToken();
  await p.shareLink.create({
    data: {
      tokenHash: hashShareToken(shareToken),
      studentId: chen.id,
      createdBy: teacher?.id ?? li.id,
      createdAt: at(-3),
      lastViewedAt: at(-1),
    },
  });
  const revokedToken = generateShareToken();
  await p.shareLink.create({
    data: {
      tokenHash: hashShareToken(revokedToken),
      studentId: students.find((s) => s.name === "吴桐")?.id ?? chen.id,
      createdBy: teacher?.id ?? li.id,
      createdAt: at(-6),
      revoked: true,
      revokedAt: at(-5),
    },
  });

  // ---- 汇总 ----
  const [aCount, sCount, ansCount, wqCount, pointCount, goalCount, notifCount] = await Promise.all([
    p.assignment.count(), p.submission.count(), p.answerRecord.count(),
    p.wrongQuestion.count(), p.masteryPoint.count(), p.learningGoal.count(), p.notification.count(),
  ]);
  console.log({ assignments: aCount, submissions: sCount, answers: ansCount, wrong: wqCount, points: pointCount, goals: goalCount, notifications: notifCount });
  console.log("陈静家长分享链接：", `https://int-6065.vercel.app/share/${shareToken}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => p.$disconnect());
