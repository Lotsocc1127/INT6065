/**
 * 种子脚本：数学（一元一次方程）+ 英语（一般现在时）知识图谱与题库、
 * 班级与 10 名学生、初始掌握度及历史、一份演示作业与作答。
 *
 * 运行：npx prisma db seed           （数据已存在则跳过）
 *       npx tsx prisma/seed.ts --force（清空重灌）
 */
import { PrismaClient, QuestionType, AssignmentType, Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { parseArr, toArrStr } from "../lib/json";

const prisma = new PrismaClient();

// 演示账号密码（可用环境变量覆盖；密码以 bcrypt 哈希入库）
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "123456";

// 确定性伪随机（mulberry32），保证种子可复现
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
const rng = mulberry32(20261013);
const pick = <T,>(arr: T[]) => arr[Math.floor(rng() * arr.length)];

const DAY = 24 * 60 * 60 * 1000;

async function main() {
  const force = process.argv.includes("--force");

  const existing = await prisma.class.count();
  if (existing > 0 && !force) {
    console.log("已存在种子数据，跳过（如需重灌：npx tsx prisma/seed.ts --force）");
    return;
  }
  if (force) {
    // 清空（顺序遵循外键依赖）
    await prisma.$transaction([
      prisma.answerRecord.deleteMany(),
      prisma.wrongQuestion.deleteMany(),
      prisma.masteryPoint.deleteMany(),
      prisma.mastery.deleteMany(),
      prisma.submission.deleteMany(),
      prisma.assignmentQuestion.deleteMany(),
      prisma.assignment.deleteMany(),
      prisma.learningGoal.deleteMany(),
      prisma.user.deleteMany(),
      prisma.class.deleteMany(),
      prisma.question.deleteMany(),
      prisma.knowledgePoint.deleteMany(),
      prisma.subject.deleteMany(),
    ]);
  }

  // ---------- 用户与班级 ----------
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const teacher = await prisma.user.create({
    data: { name: "王老师", role: Role.TEACHER, password: passwordHash },
  });
  const cls = await prisma.class.create({
    data: { name: "七年级(3)班" },
  });

  // 基础掌握度画像：学优/中等/学弱 三档
  const studentProfiles: { name: string; base: number }[] = [
    { name: "李明", base: 0.9 },
    { name: "孙悦", base: 0.85 },
    { name: "张伟", base: 0.75 },
    { name: "刘洋", base: 0.7 },
    { name: "陈静", base: 0.65 },
    { name: "赵磊", base: 0.6 },
    { name: "周涛", base: 0.58 },
    { name: "郑楠", base: 0.45 },
    { name: "王芳", base: 0.4 },
    { name: "吴桐", base: 0.3 },
  ];
  const students = [];
  const studentBase = new Map<string, number>();
  for (const p of studentProfiles) {
    const stu = await prisma.user.create({
      data: { name: p.name, role: Role.STUDENT, classId: cls.id, password: passwordHash },
    });
    studentBase.set(stu.id, p.base);
    students.push(stu);
  }

  // ---------- 学科、知识点 ----------
  const math = await prisma.subject.create({
    data: { code: "math", name: "数学" },
  });
  const english = await prisma.subject.create({
    data: { code: "english", name: "英语" },
  });

  const mathKpDefs = [
    { code: "K1", name: "等式性质", desc: "等式两边同时加、减、乘、除（不为零）同一个数，等式仍成立。" },
    { code: "K2", name: "移项·合并同类项", desc: "把方程中的项从一边移到另一边并变号，再合并同类项。" },
    { code: "K3", name: "去括号·去分母", desc: "利用分配律去括号，方程两边同乘各分母的最小公倍数去分母。" },
    { code: "K4", name: "实际问题建模", desc: "将行程、工程、销售盈亏、配套等实际问题转化为一元一次方程求解。" },
  ];
  const engKpDefs = [
    { code: "E1", name: "be 动词用法", desc: "am / is / are 与主语的搭配。" },
    { code: "E2", name: "实义动词与第三人称单数", desc: "主语为第三人称单数时动词加 -s/-es 的变化规则。" },
    { code: "E3", name: "肯定/否定/疑问句式", desc: "一般现在时的否定句与一般疑问句构成。" },
    { code: "E4", name: "日常听说应用", desc: "用一般现在时描述习惯与日常生活。" },
  ];

  const kpByCode: Record<string, { id: string }> = {};
  async function createKps(subjectId: string, defs: typeof mathKpDefs, prereqByCode: Record<string, string[]>) {
    for (const d of defs) {
      const prereqIds = (prereqByCode[d.code] ?? []).map((c) => kpByCode[c].id);
      const kp = await prisma.knowledgePoint.create({
        data: {
          subjectId,
          code: d.code,
          name: d.name,
          description: d.desc,
          prereqIds: toArrStr(prereqIds),
        },
      });
      kpByCode[d.code] = { id: kp.id };
    }
  }
  await createKps(math.id, mathKpDefs, {
    K2: ["K1"],
    K3: ["K2"],
    K4: ["K2", "K3"],
  });
  await createKps(english.id, engKpDefs, {
    E2: ["E1"],
    E3: ["E2"],
    E4: ["E2", "E3"],
  });

  // ---------- 题库 ----------
  type QDef = {
    kps: string[];
    type: QuestionType;
    difficulty: number;
    stem: string;
    options?: string[];
    answer: string;
    analysis: string;
  };

  const mathQuestions: QDef[] = [
    // K1 等式性质
    { kps: ["K1"], type: "SINGLE_CHOICE", difficulty: 1, stem: "已知 3x = 9，则 x 等于（　）", options: ["2", "3", "6", "27"], answer: "B", analysis: "等式两边同时除以 3，得 x = 3。" },
    { kps: ["K1"], type: "SINGLE_CHOICE", difficulty: 1, stem: "等式 2x + 1 = 7 两边同时减去 1，可得（　）", options: ["2x = 6", "2x = 8", "2x = 7", "2x = 1"], answer: "A", analysis: "等式两边同时减去 1：2x + 1 - 1 = 7 - 1，即 2x = 6。" },
    { kps: ["K1"], type: "FILL_BLANK", difficulty: 1, stem: "已知 5x = 20，则 x = ______。", answer: "4", analysis: "等式两边同时除以 5，得 x = 4。" },
    // K2 移项·合并同类项
    { kps: ["K2"], type: "FILL_BLANK", difficulty: 1, stem: "解方程：x + 3 = 8，得 x = ______。", answer: "5", analysis: "移项：x = 8 - 3 = 5。" },
    { kps: ["K2"], type: "FILL_BLANK", difficulty: 2, stem: "解方程：3x - 2 = 7，得 x = ______。", answer: "3", analysis: "移项得 3x = 9，两边除以 3 得 x = 3。" },
    { kps: ["K2"], type: "SINGLE_CHOICE", difficulty: 2, stem: "方程 2x - 1 = 3x + 2 的解是（　）", options: ["1", "-3", "3", "-1"], answer: "B", analysis: "移项：2x - 3x = 2 + 1，得 -x = 3，即 x = -3。" },
    { kps: ["K2"], type: "FILL_BLANK", difficulty: 2, stem: "解方程：5x + 2 = 3x + 6，得 x = ______。", answer: "2", analysis: "移项：5x - 3x = 6 - 2，即 2x = 4，x = 2。" },
    // K3 去括号·去分母
    { kps: ["K3"], type: "FILL_BLANK", difficulty: 2, stem: "解方程：2(x + 3) = 14，得 x = ______。", answer: "4", analysis: "去括号：2x + 6 = 14，移项得 2x = 8，x = 4。" },
    { kps: ["K3"], type: "SINGLE_CHOICE", difficulty: 2, stem: "方程 (x + 1) / 3 = 2 的解是（　）", options: ["5", "7", "3", "6"], answer: "A", analysis: "两边同乘 3：x + 1 = 6，x = 5。" },
    { kps: ["K3"], type: "FILL_BLANK", difficulty: 3, stem: "解方程：3(x - 2) = 2x + 1，得 x = ______。", answer: "7", analysis: "去括号：3x - 6 = 2x + 1，移项：x = 7。" },
    { kps: ["K3"], type: "FILL_BLANK", difficulty: 4, stem: "解方程：(x - 1)/2 - (x + 1)/3 = 1，得 x = ______。", answer: "11", analysis: "两边同乘 6：3(x-1) - 2(x+1) = 6，得 3x - 3 - 2x - 2 = 6，即 x = 11。" },
    { kps: ["K3"], type: "SINGLE_CHOICE", difficulty: 3, stem: "方程 (2x + 1)/3 = (x + 1)/2 的解是（　）", options: ["1", "2", "-1", "0"], answer: "A", analysis: "交叉相乘：2(2x+1) = 3(x+1)，4x + 2 = 3x + 3，x = 1。" },
    // K4 实际问题建模
    { kps: ["K4"], type: "FILL_BLANK", difficulty: 2, stem: "甲、乙两地相距 240 km，一辆汽车从甲地出发，以 60 km/h 的速度匀速行驶，______ 小时后到达乙地。", answer: "4", analysis: "设 x 小时后到达，60x = 240，x = 4。" },
    { kps: ["K4"], type: "SINGLE_CHOICE", difficulty: 3, stem: "一件商品按成本价提高 40% 后标价，又以 8 折出售，售价为 112 元，该商品的成本价是（　）", options: ["80 元", "90 元", "100 元", "120 元"], answer: "C", analysis: "设成本价为 x 元，0.8 × 1.4x = 112，解得 x = 100。" },
    { kps: ["K4"], type: "OPEN_RESPONSE", difficulty: 3, stem: "甲、乙两人从相距 360 米的两地同时出发相向而行，甲每秒走 5 米，乙每秒走 4 米。几秒后两人相遇？请列方程并求解。", answer: "设 x 秒后相遇，5x + 4x = 360，9x = 360，x = 40。答：40 秒后相遇。", analysis: "等量关系：甲走的路程 + 乙走的路程 = 总路程。列方程 5x + 4x = 360。" },
    { kps: ["K4"], type: "OPEN_RESPONSE", difficulty: 4, stem: "某车间有 22 名工人，每人每天可生产螺钉 1200 个或螺母 2000 个，1 个螺钉需配 2 个螺母。应分配多少名工人生产螺钉，多少名工人生产螺母，才能使每天生产的产品刚好配套？请列方程并求解。", answer: "设 x 名工人生产螺钉，则 (22-x) 名生产螺母。2×1200x = 2000(22-x)，2400x = 44000 - 2000x，4400x = 44000，x = 10。答：10 名生产螺钉，12 名生产螺母。", analysis: "等量关系：每天生产的螺母数是螺钉数的 2 倍。" },
    { kps: ["K4"], type: "SINGLE_CHOICE", difficulty: 3, stem: "一项工程，甲单独做 10 天完成，乙单独做 15 天完成，两人合作（　）天完成。", options: ["5 天", "6 天", "8 天", "12.5 天"], answer: "B", analysis: "设合作 x 天完成，(1/10 + 1/15)x = 1，x = 6。" },
    { kps: ["K4"], type: "OPEN_RESPONSE", difficulty: 3, stem: "某商品进价 80 元，按 20% 的利润率定价后打九折出售。求：售价是多少元？每件盈利多少元？请写出计算过程。", answer: "定价：80×(1+20%) = 96 元；售价：96×0.9 = 86.4 元；盈利：86.4 - 80 = 6.4 元。答：售价 86.4 元，每件盈利 6.4 元。", analysis: "先由进价和利润率求定价，再由折扣求售价，最后售价减进价得盈利。" },
  ];

  const englishQuestions: QDef[] = [
    { kps: ["E1"], type: "FILL_BLANK", difficulty: 1, stem: "She ______ (be) a student.", answer: "is", analysis: "主语 she 为第三人称单数，be 动词用 is。" },
    { kps: ["E1"], type: "SINGLE_CHOICE", difficulty: 1, stem: "There ______ two books on the desk.", options: ["is", "are", "am", "be"], answer: "B", analysis: "主语 two books 为复数，be 动词用 are。" },
    { kps: ["E1"], type: "FILL_BLANK", difficulty: 1, stem: "I ______ (be) not tired today.", answer: "am", analysis: "主语 I 搭配 be 动词 am。" },
    { kps: ["E2"], type: "FILL_BLANK", difficulty: 2, stem: "He ______ (play) football every day.", answer: "plays", analysis: "主语 he 为第三人称单数，一般现在时动词加 -s。" },
    { kps: ["E2"], type: "SINGLE_CHOICE", difficulty: 2, stem: "My father ______ to work by bus every morning.", options: ["go", "goes", "going", "went"], answer: "B", analysis: "主语 My father 为第三人称单数，一般现在时用 goes。" },
    { kps: ["E2"], type: "FILL_BLANK", difficulty: 2, stem: "She ______ (watch) TV in the evening.", answer: "watches", analysis: "以 -ch 结尾的动词，第三人称单数加 -es。" },
    { kps: ["E3"], type: "FILL_BLANK", difficulty: 2, stem: "______ he like apples? (用 do 或 does 填空)", answer: "Does", analysis: "主语 he 为第三人称单数，一般疑问句用 Does 开头。" },
    { kps: ["E3"], type: "SINGLE_CHOICE", difficulty: 2, stem: "They don't ______ math. They think it's hard.", options: ["like", "likes", "liking", "liked"], answer: "A", analysis: "don't 后接动词原形 like。" },
    { kps: ["E3"], type: "FILL_BLANK", difficulty: 3, stem: "She doesn't ______ (have) a bike.", answer: "have", analysis: "doesn't 后接动词原形 have。" },
    { kps: ["E4"], type: "OPEN_RESPONSE", difficulty: 2, stem: "用一般现在时写 3 个句子，介绍你的日常生活（如起床时间、上学方式、爱好）。", answer: "示例：I get up at 6:30. I go to school by bike. I like reading books.（答案不唯一，语法正确即可）", analysis: "检查：动词形式与主语一致；第三人称单数动词加 -s/-es；句式完整。" },
    { kps: ["E4"], type: "FILL_BLANK", difficulty: 2, stem: "把句子 \"I go to school at 7:00.\" 改为以 Tom 为主语：Tom ______ to school at 7:00.", answer: "goes", analysis: "主语改为第三人称单数 Tom，动词 go 变为 goes。" },
  ];

  async function createQuestions(subjectId: string, defs: QDef[]) {
    for (const d of defs) {
      await prisma.question.create({
        data: {
          subjectId,
          kpIds: toArrStr(d.kps.map((c) => kpByCode[c].id)),
          type: d.type,
          difficulty: d.difficulty,
          stem: d.stem,
          options: d.options ? toArrStr(d.options) : null,
          answer: d.answer,
          analysis: d.analysis,
        },
      });
    }
  }
  await createQuestions(math.id, mathQuestions);
  await createQuestions(english.id, englishQuestions);

  // ---------- 掌握度（含历史轨迹） ----------
  const mathKps = await prisma.knowledgePoint.findMany({ where: { subjectId: math.id } });
  const engKps = await prisma.knowledgePoint.findMany({ where: { subjectId: english.id } });

  const mathMasteryMap = new Map<string, Map<string, number>>(); // studentId -> kpId -> value
  const engMasteryMap = new Map<string, Map<string, number>>();

  for (const stu of students) {
    const base = studentBase.get(stu.id)!;
    for (let i = 0; i < mathKps.length; i++) {
      const kp = mathKps[i];
      const jitter = (rng() - 0.5) * 0.24;
      const kpPenalty = i === 3 ? -0.06 : 0; // K4 实际问题最难
      const value = Math.min(0.98, Math.max(0.08, base + jitter + kpPenalty));
      if (!mathMasteryMap.has(stu.id)) mathMasteryMap.set(stu.id, new Map());
      mathMasteryMap.get(stu.id)!.set(kp.id, value);
    }
    for (let i = 0; i < engKps.length; i++) {
      const kp = engKps[i];
      const value = Math.min(0.95, Math.max(0.1, base * 0.75 + (rng() - 0.5) * 0.2));
      if (!engMasteryMap.has(stu.id)) engMasteryMap.set(stu.id, new Map());
      engMasteryMap.get(stu.id)!.set(kp.id, value);
    }
  }

  async function seedMastery(studentId: string, kps: typeof mathKps, map: Map<string, number>) {
    for (const kp of kps) {
      const final = map.get(kp.id)!;
      const mastery = await prisma.mastery.create({
        data: {
          studentId,
          kpId: kp.id,
          subjectId: kp.subjectId,
          value: final,
          history: {
            create: Array.from({ length: 5 }, (_, i) => {
              // 近两周 5 个点，整体向上、贴近最终值
              const trend = final - (4 - i) * 0.06 + (rng() - 0.5) * 0.05;
              return {
                value: Math.min(1, Math.max(0, trend)),
                at: new Date(Date.now() - (4 - i) * 3 * DAY),
              };
            }),
          },
        },
      });
      void mastery;
    }
  }

  for (const stu of students) {
    await seedMastery(stu.id, mathKps, mathMasteryMap.get(stu.id)!);
    await seedMastery(stu.id, engKps, engMasteryMap.get(stu.id)!);
  }

  // ---------- 演示作业 + 作答 ----------
  const assignmentQuestionDefs = [
    { kp: "K1", stem: "已知 3x = 9，则 x 等于（　）" },
    { kp: "K2", stem: "解方程：x + 3 = 8，得 x = ______。" },
    { kp: "K2", stem: "解方程：3x - 2 = 7，得 x = ______。" },
    { kp: "K3", stem: "解方程：2(x + 3) = 14，得 x = ______。" },
    { kp: "K4", stem: "甲、乙两地相距 240 km，一辆汽车从甲地出发，以 60 km/h 的速度匀速行驶，______ 小时后到达乙地。" },
  ];
  const aqQuestions = await Promise.all(
    assignmentQuestionDefs.map(async (d) => {
      return prisma.question.findFirstOrThrow({
        where: { subjectId: math.id, stem: d.stem },
      });
    })
  );
  const assignment = await prisma.assignment.create({
    data: {
      subjectId: math.id,
      classId: cls.id,
      type: AssignmentType.HOMEWORK,
      title: "一元一次方程 · 第 1 周作业",
      dueAt: new Date(Date.now() + 3 * DAY),
      questions: {
        create: aqQuestions.map((q, i) => ({ questionId: q.id, order: i + 1 })),
      },
    },
  });

  const errorTagPool = ["计算失误", "概念混淆", "步骤遗漏", "审题错误"];
  for (const stu of students) {
    const answers = await Promise.all(
      aqQuestions.map(async (q) => {
        const kpIds = parseArr(q.kpIds);
        // 以该生对应知识点的掌握度为正确概率（演示数据）
        const kpMastery = Math.max(...kpIds.map((id) => mathMasteryMap.get(stu.id)!.get(id) ?? 0.5));
        const correct = rng() < kpMastery * 0.95;
        let response = q.answer;
        if (!correct) {
          if (q.type === QuestionType.SINGLE_CHOICE) {
            const opts = parseArr<string>(q.options);
            response = pick(opts.filter((o) => o !== q.answer)) ?? "（空）";
          } else {
            response = String(Number(q.answer) + pick([-1, 1, 2, -2, 3])).trim();
          }
        }
        return { questionId: q.id, kpIds, correct, response };
      })
    );
    const submission = await prisma.submission.create({
      data: {
        assignmentId: assignment.id,
        studentId: stu.id,
        submittedAt: new Date(Date.now() - DAY - Math.floor(rng() * 2 * DAY)),
        answers: {
          create: answers.map((a) => ({
            questionId: a.questionId,
            kpIds: toArrStr(a.kpIds),
            studentId: stu.id,
            response: a.response,
            isCorrect: a.correct,
            score: a.correct ? 1 : 0,
            timeSpentMs: 30_000 + Math.floor(rng() * 240_000),
            errorTags: a.correct ? "[]" : toArrStr([pick(errorTagPool)]),
          })),
        },
      },
    });
    void submission;

    // 错题本
    for (const a of answers) {
      if (!a.correct) {
        await prisma.wrongQuestion.create({
          data: {
            studentId: stu.id,
            questionId: a.questionId,
            kpIds: toArrStr(a.kpIds),
            wrongCount: 1,
          },
        });
      }
    }
  }

  // ---------- 目标（演示） ----------
  const goalTemplates = [
    "本周每天完成 5 道解方程练习",
    "掌握去分母的方法，测验正确率达到 80%",
    "整理错题本并重做全部错题",
  ];
  for (const stu of students) {
    await prisma.learningGoal.create({
      data: {
        studentId: stu.id,
        content: pick(goalTemplates),
        done: rng() < 0.3,
      },
    });
  }

  console.log("种子完成：");
  console.log(`  教师：${teacher.name}`);
  console.log(`  班级：${cls.name}（${students.length} 名学生）`);
  console.log(`  数学：${mathKpDefs.length} 个知识点，${mathQuestions.length} 道题`);
  console.log(`  英语：${engKpDefs.length} 个知识点，${englishQuestions.length} 道题`);
  console.log(`  演示作业：${assignment.title}（10 份作答）`);
  console.log(`  演示账号密码统一为 ${DEMO_PASSWORD}（bcrypt 哈希存储）`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
