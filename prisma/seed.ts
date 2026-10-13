/**
 * 种子脚本：数学、英语、语文三科（人教版七年级上册）知识图谱与题库、
 * 班级与 10 名学生、初始掌握度及历史、两份演示作业（数学作业 + 语文小测）与作答。
 *
 * 运行：npx prisma db seed           （数据已存在则跳过）
 *       npx tsx prisma/seed.ts --force（清空重灌）
 */
import { PrismaClient, QuestionType, AssignmentType, Role, type User } from "@prisma/client";
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
  const students: User[] = [];
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
  const chinese = await prisma.subject.create({
    data: { code: "chinese", name: "语文" },
  });

  interface KpDef {
    code: string;
    name: string;
    desc: string;
    /** 掌握度种子惩罚项（该知识点整体偏难），如 -0.06 */
    penalty?: number;
  }

  const mathKpDefs: KpDef[] = [
    { code: "K1", name: "有理数基础", desc: "正数与负数、数轴、相反数与绝对值，有理数的大小比较。" },
    { code: "K2", name: "有理数的运算", desc: "加、减、乘、除与乘方，混合运算顺序，运算律简化计算。" },
    { code: "K3", name: "整式的加减", desc: "单项式与多项式、同类项、合并同类项与去括号，化简求值。" },
    { code: "K4", name: "一元一次方程", desc: "等式性质、移项、去括号、去分母解一元一次方程。" },
    { code: "K5", name: "实际问题与方程", desc: "行程、工程、销售盈亏、配套等实际问题的建模与求解。", penalty: -0.06 },
    { code: "K6", name: "几何图形初步", desc: "立体图形与平面图形、从不同方向看物体、直线射线线段与中点。" },
    { code: "K7", name: "角", desc: "角的表示与度量、角的大小比较、角平分线、余角与补角。" },
    { code: "K8", name: "线段与角的计算", desc: "和差倍分关系、中点与角平分线综合计算、分类讨论思想。", penalty: -0.04 },
  ];
  const engKpDefs: KpDef[] = [
    { code: "E1", name: "一般现在时 · be 动词", desc: "am / is / are 与主语的搭配，be 动词的否定与疑问。" },
    { code: "E2", name: "一般现在时 · 实义动词", desc: "第三人称单数动词变化（-s/-es），do / does 构成否定与疑问。" },
    { code: "E3", name: "名词与代词", desc: "可数名词复数、不可数名词、人称代词与物主代词。" },
    { code: "E4", name: "冠词与介词", desc: "a / an / the 基本用法，常见时间与地点介词。" },
    { code: "E5", name: "There be 句型", desc: "There be 的单复数与就近原则，用方位介词描述位置。" },
    { code: "E6", name: "现在进行时", desc: "be doing 结构，与一般现在时的区别。" },
    { code: "E7", name: "词汇与交际", desc: "七年级话题词汇（家庭、学校、食物、运动），日常交际用语。" },
    { code: "E8", name: "阅读与写作基础", desc: "短文细节理解与推断，用一般现在时写 5-8 句短文。" },
  ];
  const chiKpDefs: KpDef[] = [
    { code: "C1", name: "字音字形", desc: "易错字音、多音字、形近字与易错字辨析。" },
    { code: "C2", name: "词语运用", desc: "近义词辨析、成语理解与语境运用、关联词使用。" },
    { code: "C3", name: "病句辨析与修改", desc: "成分残缺、搭配不当、语序不当、重复啰嗦等常见语病。" },
    { code: "C4", name: "古诗文默写", desc: "七上课内古诗词曲的识记与理解性默写。" },
    { code: "C5", name: "课内文言文阅读", desc: "实词虚词、句子翻译、内容理解（《世说新语》《论语》等）。", penalty: -0.05 },
    { code: "C6", name: "现代文阅读", desc: "记叙文的概括、词句赏析、形象分析与主旨理解。" },
    { code: "C7", name: "名著与综合性学习", desc: "《朝花夕拾》《西游记》常识，语言综合运用。" },
    { code: "C8", name: "作文基础", desc: "审题立意、结构安排、记叙文片段与整篇写作。", penalty: -0.06 },
  ];

  const kpByCode: Record<string, { id: string }> = {};
  async function createKps(subjectId: string, defs: KpDef[], prereqByCode: Record<string, string[]>) {
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
    K4: ["K3"],
    K5: ["K4"],
    K7: ["K6"],
    K8: ["K6", "K7"],
  });
  await createKps(english.id, engKpDefs, {
    E2: ["E1"],
    E4: ["E3"],
    E5: ["E4"],
    E6: ["E2"],
    E7: ["E2"],
    E8: ["E6", "E7"],
  });
  await createKps(chinese.id, chiKpDefs, {
    C2: ["C1"],
    C3: ["C2"],
    C5: ["C4"],
    C6: ["C2"],
    C7: ["C2"],
    C8: ["C3", "C6"],
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
    // K1 有理数基础
    { kps: ["K1"], type: "SINGLE_CHOICE", difficulty: 1, stem: "在 -2，+3.5，0，-2/3 中，负数有（　）", options: ["1 个", "2 个", "3 个", "4 个"], answer: "B", analysis: "负数带负号：-2 与 -2/3，共 2 个；0 既不是正数也不是负数。" },
    { kps: ["K1"], type: "FILL_BLANK", difficulty: 1, stem: "-5 的相反数是 ______。", answer: "5", analysis: "只有符号不同的两个数互为相反数，-5 的相反数是 5。" },
    // K2 有理数的运算
    { kps: ["K2"], type: "SINGLE_CHOICE", difficulty: 2, stem: "计算 (-3) + 5 - (-2) 的结果是（　）", options: ["-6", "0", "4", "-4"], answer: "C", analysis: "(-3) + 5 = 2，2 - (-2) = 2 + 2 = 4。减去一个数等于加上它的相反数。" },
    { kps: ["K2"], type: "FILL_BLANK", difficulty: 2, stem: "计算：(-2)³ = ______。", answer: "-8", analysis: "(-2)³ = (-2) × (-2) × (-2) = -8，负数的奇次幂为负。" },
    // K3 整式的加减
    { kps: ["K3"], type: "FILL_BLANK", difficulty: 1, stem: "化简：2x + 3x - x = ______。", answer: "4x", analysis: "合并同类项：2x + 3x - x = (2 + 3 - 1)x = 4x。" },
    { kps: ["K3"], type: "FILL_BLANK", difficulty: 2, stem: "化简：3a + 2b - a - 4b = ______。", answer: "2a-2b", analysis: "合并同类项：(3a - a) + (2b - 4b) = 2a - 2b。" },
    { kps: ["K3"], type: "SINGLE_CHOICE", difficulty: 3, stem: "当 a = -2 时，代数式 2a² - 3a + 1 的值是（　）", options: ["9", "15", "-9", "11"], answer: "B", analysis: "代入：2×(-2)² - 3×(-2) + 1 = 8 + 6 + 1 = 15。" },
    // K4 一元一次方程（等式性质/移项/去括号/去分母）
    { kps: ["K4"], type: "SINGLE_CHOICE", difficulty: 1, stem: "已知 3x = 9，则 x 等于（　）", options: ["2", "3", "6", "27"], answer: "B", analysis: "等式两边同时除以 3，得 x = 3。" },
    { kps: ["K4"], type: "SINGLE_CHOICE", difficulty: 1, stem: "等式 2x + 1 = 7 两边同时减去 1，可得（　）", options: ["2x = 6", "2x = 8", "2x = 7", "2x = 1"], answer: "A", analysis: "等式两边同时减去 1：2x + 1 - 1 = 7 - 1，即 2x = 6。" },
    { kps: ["K4"], type: "FILL_BLANK", difficulty: 1, stem: "已知 5x = 20，则 x = ______。", answer: "4", analysis: "等式两边同时除以 5，得 x = 4。" },
    { kps: ["K4"], type: "FILL_BLANK", difficulty: 1, stem: "解方程：x + 3 = 8，得 x = ______。", answer: "5", analysis: "移项：x = 8 - 3 = 5。" },
    { kps: ["K4"], type: "FILL_BLANK", difficulty: 2, stem: "解方程：3x - 2 = 7，得 x = ______。", answer: "3", analysis: "移项得 3x = 9，两边除以 3 得 x = 3。" },
    { kps: ["K4"], type: "SINGLE_CHOICE", difficulty: 2, stem: "方程 2x - 1 = 3x + 2 的解是（　）", options: ["1", "-3", "3", "-1"], answer: "B", analysis: "移项：2x - 3x = 2 + 1，得 -x = 3，即 x = -3。" },
    { kps: ["K4"], type: "FILL_BLANK", difficulty: 2, stem: "解方程：5x + 2 = 3x + 6，得 x = ______。", answer: "2", analysis: "移项：5x - 3x = 6 - 2，即 2x = 4，x = 2。" },
    { kps: ["K4"], type: "FILL_BLANK", difficulty: 2, stem: "解方程：2(x + 3) = 14，得 x = ______。", answer: "4", analysis: "去括号：2x + 6 = 14，移项得 2x = 8，x = 4。" },
    { kps: ["K4"], type: "SINGLE_CHOICE", difficulty: 2, stem: "方程 (x + 1) / 3 = 2 的解是（　）", options: ["5", "7", "3", "6"], answer: "A", analysis: "两边同乘 3：x + 1 = 6，x = 5。" },
    { kps: ["K4"], type: "FILL_BLANK", difficulty: 3, stem: "解方程：3(x - 2) = 2x + 1，得 x = ______。", answer: "7", analysis: "去括号：3x - 6 = 2x + 1，移项：x = 7。" },
    { kps: ["K4"], type: "FILL_BLANK", difficulty: 4, stem: "解方程：(x - 1)/2 - (x + 1)/3 = 1，得 x = ______。", answer: "11", analysis: "两边同乘 6：3(x-1) - 2(x+1) = 6，得 3x - 3 - 2x - 2 = 6，即 x = 11。" },
    { kps: ["K4"], type: "SINGLE_CHOICE", difficulty: 3, stem: "方程 (2x + 1)/3 = (x + 1)/2 的解是（　）", options: ["1", "2", "-1", "0"], answer: "A", analysis: "交叉相乘：2(2x+1) = 3(x+1)，4x + 2 = 3x + 3，x = 1。" },
    // K5 实际问题与方程
    { kps: ["K5"], type: "FILL_BLANK", difficulty: 2, stem: "甲、乙两地相距 240 km，一辆汽车从甲地出发，以 60 km/h 的速度匀速行驶，______ 小时后到达乙地。", answer: "4", analysis: "设 x 小时后到达，60x = 240，x = 4。" },
    { kps: ["K5"], type: "SINGLE_CHOICE", difficulty: 3, stem: "一件商品按成本价提高 40% 后标价，又以 8 折出售，售价为 112 元，该商品的成本价是（　）", options: ["80 元", "90 元", "100 元", "120 元"], answer: "C", analysis: "设成本价为 x 元，0.8 × 1.4x = 112，解得 x = 100。" },
    { kps: ["K5"], type: "OPEN_RESPONSE", difficulty: 3, stem: "甲、乙两人从相距 360 米的两地同时出发相向而行，甲每秒走 5 米，乙每秒走 4 米。几秒后两人相遇？请列方程并求解。", answer: "设 x 秒后相遇，5x + 4x = 360，9x = 360，x = 40。答：40 秒后相遇。", analysis: "等量关系：甲走的路程 + 乙走的路程 = 总路程。列方程 5x + 4x = 360。" },
    { kps: ["K5"], type: "OPEN_RESPONSE", difficulty: 4, stem: "某车间有 22 名工人，每人每天可生产螺钉 1200 个或螺母 2000 个，1 个螺钉需配 2 个螺母。应分配多少名工人生产螺钉，多少名工人生产螺母，才能使每天生产的产品刚好配套？请列方程并求解。", answer: "设 x 名工人生产螺钉，则 (22-x) 名生产螺母。2×1200x = 2000(22-x)，2400x = 44000 - 2000x，4400x = 44000，x = 10。答：10 名生产螺钉，12 名生产螺母。", analysis: "等量关系：每天生产的螺母数是螺钉数的 2 倍。" },
    { kps: ["K5"], type: "SINGLE_CHOICE", difficulty: 3, stem: "一项工程，甲单独做 10 天完成，乙单独做 15 天完成，两人合作（　）天完成。", options: ["5 天", "6 天", "8 天", "12.5 天"], answer: "B", analysis: "设合作 x 天完成，(1/10 + 1/15)x = 1，x = 6。" },
    { kps: ["K5"], type: "OPEN_RESPONSE", difficulty: 3, stem: "某商品进价 80 元，按 20% 的利润率定价后打九折出售。求：售价是多少元？每件盈利多少元？请写出计算过程。", answer: "定价：80×(1+20%) = 96 元；售价：96×0.9 = 86.4 元；盈利：86.4 - 80 = 6.4 元。答：售价 86.4 元，每件盈利 6.4 元。", analysis: "先由进价和利润率求定价，再由折扣求售价，最后售价减进价得盈利。" },
    // K6 几何图形初步
    { kps: ["K6"], type: "SINGLE_CHOICE", difficulty: 1, stem: "下列图形中，属于平面图形的是（　）", options: ["长方体", "圆锥", "三角形", "圆柱"], answer: "C", analysis: "三角形各部分在同一平面内，是平面图形；长方体、圆锥、圆柱都是立体图形。" },
    { kps: ["K6"], type: "FILL_BLANK", difficulty: 1, stem: "经过两点有且只有 ______ 条直线。", answer: "一|1|一条", analysis: "两点确定一条直线，这是直线的基本性质。" },
    // K7 角
    { kps: ["K7"], type: "SINGLE_CHOICE", difficulty: 2, stem: "已知 ∠A = 30°25′，则 ∠A 的余角等于（　）", options: ["59°35′", "60°35′", "59°75′", "60°25′"], answer: "A", analysis: "余角 = 90° - 30°25′ = 59°35′。注意 1° = 60′ 的借位。" },
    { kps: ["K7"], type: "FILL_BLANK", difficulty: 2, stem: "已知 ∠1 = 50°，则 ∠1 的补角等于 ______°。", answer: "130", analysis: "补角 = 180° - 50° = 130°。两个角的和为 180° 时互为补角。" },
    // K8 线段与角的计算
    { kps: ["K8"], type: "FILL_BLANK", difficulty: 2, stem: "点 C 是线段 AB 的中点，若 AC = 3 cm，则 AB = ______ cm。", answer: "6", analysis: "中点把线段分成相等的两部分，AB = 2AC = 6 cm。" },
    { kps: ["K8"], type: "FILL_BLANK", difficulty: 3, stem: "已知 ∠AOB = 80°，OC 平分 ∠AOB，则 ∠AOC = ______°。", answer: "40", analysis: "角平分线把角分成两个相等的角，∠AOC = 80° ÷ 2 = 40°。" },
    { kps: ["K8"], type: "SINGLE_CHOICE", difficulty: 4, stem: "已知线段 AB = 10 cm，点 C 在直线 AB 上，且 BC = 4 cm，则 AC 的长为（　）", options: ["6 cm", "14 cm", "6 cm 或 14 cm", "4 cm 或 10 cm"], answer: "C", analysis: "分类讨论：点 C 在 A、B 之间时 AC = 6 cm；点 C 在 B 点外侧时 AC = 14 cm。" },
  ];

  const englishQuestions: QDef[] = [
    // E1 一般现在时 · be 动词
    { kps: ["E1"], type: "FILL_BLANK", difficulty: 1, stem: "She ______ (be) a student.", answer: "is", analysis: "主语 she 为第三人称单数，be 动词用 is。" },
    { kps: ["E1"], type: "FILL_BLANK", difficulty: 1, stem: "I ______ (be) not tired today.", answer: "am", analysis: "主语 I 搭配 be 动词 am。" },
    { kps: ["E1"], type: "SINGLE_CHOICE", difficulty: 1, stem: "My brother and I ______ good friends.", options: ["is", "are", "am", "be"], answer: "B", analysis: "主语 My brother and I 表示两个人，为复数，be 动词用 are。" },
    // E2 一般现在时 · 实义动词
    { kps: ["E2"], type: "FILL_BLANK", difficulty: 2, stem: "He ______ (play) football every day.", answer: "plays", analysis: "主语 he 为第三人称单数，一般现在时动词加 -s。" },
    { kps: ["E2"], type: "SINGLE_CHOICE", difficulty: 2, stem: "My father ______ to work by bus every morning.", options: ["go", "goes", "going", "went"], answer: "B", analysis: "主语 My father 为第三人称单数，一般现在时用 goes。" },
    { kps: ["E2"], type: "FILL_BLANK", difficulty: 2, stem: "She ______ (watch) TV in the evening.", answer: "watches", analysis: "以 -ch 结尾的动词，第三人称单数加 -es。" },
    { kps: ["E2"], type: "FILL_BLANK", difficulty: 2, stem: "______ he like apples? (用 do 或 does 填空)", answer: "Does", analysis: "主语 he 为第三人称单数，一般疑问句用 Does 开头。" },
    { kps: ["E2"], type: "SINGLE_CHOICE", difficulty: 2, stem: "They don't ______ math. They think it's hard.", options: ["like", "likes", "liking", "liked"], answer: "A", analysis: "don't 后接动词原形 like。" },
    { kps: ["E2"], type: "FILL_BLANK", difficulty: 3, stem: "She doesn't ______ (have) a bike.", answer: "have", analysis: "doesn't 后接动词原形 have。" },
    { kps: ["E2"], type: "FILL_BLANK", difficulty: 2, stem: "把句子 \"I go to school at 7:00.\" 改为以 Tom 为主语：Tom ______ to school at 7:00.", answer: "goes", analysis: "主语改为第三人称单数 Tom，动词 go 变为 goes。" },
    // E3 名词与代词
    { kps: ["E3"], type: "SINGLE_CHOICE", difficulty: 1, stem: "There are many ______ in the school library.", options: ["book", "books", "a book", "the book"], answer: "B", analysis: "many 后接可数名词复数，用 books。" },
    { kps: ["E3"], type: "FILL_BLANK", difficulty: 2, stem: "用所给词的适当形式填空：This is ______ (he) pen.", answer: "his", analysis: "修饰名词 pen 需用形容词性物主代词 his。" },
    { kps: ["E3"], type: "SINGLE_CHOICE", difficulty: 2, stem: "—Are these your pencils? —No, ______ aren't.", options: ["they", "these", "those", "it"], answer: "A", analysis: "these 指代复数名词，答语中用 they 代替。" },
    // E4 冠词与介词
    { kps: ["E4"], type: "SINGLE_CHOICE", difficulty: 1, stem: "I have ______ apple and ______ banana.", options: ["a; a", "an; a", "an; an", "a; an"], answer: "B", analysis: "apple 以元音音素开头用 an，banana 以辅音音素开头用 a。" },
    { kps: ["E4"], type: "FILL_BLANK", difficulty: 1, stem: "He often goes to school ______ foot. (填介词)", answer: "on", analysis: "on foot 是固定搭配，意为「步行」。" },
    { kps: ["E4"], type: "SINGLE_CHOICE", difficulty: 2, stem: "My birthday is ______ June 1st.", options: ["in", "on", "at", "of"], answer: "B", analysis: "具体到某一天（6 月 1 日）用介词 on。" },
    // E5 There be 句型
    { kps: ["E5"], type: "SINGLE_CHOICE", difficulty: 1, stem: "There ______ two books on the desk.", options: ["is", "are", "am", "be"], answer: "B", analysis: "主语 two books 为复数，be 动词用 are。" },
    { kps: ["E5"], type: "FILL_BLANK", difficulty: 2, stem: "There ______ (be) some milk in the glass.", answer: "is", analysis: "milk 为不可数名词，be 动词用 is。" },
    { kps: ["E5"], type: "SINGLE_CHOICE", difficulty: 2, stem: "There ______ a book and two pens on the desk.", options: ["is", "are", "be", "am"], answer: "A", analysis: "There be 就近原则：离 be 动词最近的主语 a book 为单数，用 is。" },
    // E6 现在进行时
    { kps: ["E6"], type: "FILL_BLANK", difficulty: 2, stem: "Look! The children ______ (run) on the playground.", answer: "are running", analysis: "Look! 提示动作正在进行，主语复数，用 are running。" },
    { kps: ["E6"], type: "SINGLE_CHOICE", difficulty: 2, stem: "—What are you doing? —I ______ my homework.", options: ["do", "does", "am doing", "is doing"], answer: "C", analysis: "问句用现在进行时提问，答语用 am doing 呼应。" },
    { kps: ["E6"], type: "FILL_BLANK", difficulty: 2, stem: "Listen! She ______ (sing) in the room.", answer: "is singing", analysis: "Listen! 提示动作正在进行，主语第三人称单数，用 is singing。" },
    // E7 词汇与交际
    { kps: ["E7"], type: "SINGLE_CHOICE", difficulty: 1, stem: "—How are you? —______", options: ["How do you do?", "I'm fine, thank you.", "Goodbye!", "Thank you."], answer: "B", analysis: "How are you? 询问近况，回答 I'm fine, thank you." },
    { kps: ["E7"], type: "SINGLE_CHOICE", difficulty: 1, stem: "—Thank you for your help. —______", options: ["You're welcome.", "Yes, please.", "I'm sorry.", "Good morning."], answer: "A", analysis: "对感谢的回答用 You're welcome（不用谢）。" },
    { kps: ["E7"], type: "FILL_BLANK", difficulty: 2, stem: "We have lunch at ______ (中午) every day.", answer: "noon", analysis: "at noon 意为「在中午」，noon 表示中午十二点。" },
    // E8 阅读与写作基础
    { kps: ["E8"], type: "OPEN_RESPONSE", difficulty: 2, stem: "用一般现在时写 3 个句子，介绍你的日常生活（如起床时间、上学方式、爱好）。", answer: "示例：I get up at 6:30. I go to school by bike. I like reading books.（答案不唯一，语法正确即可）", analysis: "检查：动词形式与主语一致；第三人称单数动词加 -s/-es；句式完整。" },
    { kps: ["E8"], type: "SINGLE_CHOICE", difficulty: 3, stem: "阅读短文：Tom is a student. He gets up at 6:30 every morning. After breakfast, he goes to school by bike. He likes English and music. He goes home at 5:00 in the afternoon. 问：How does Tom go to school?", options: ["By bus.", "By bike.", "On foot.", "By car."], answer: "B", analysis: "短文原句 he goes to school by bike，细节题直接定位。" },
    { kps: ["E8"], type: "OPEN_RESPONSE", difficulty: 3, stem: "用一般现在时写 5 个句子，介绍你的一位朋友（姓名、年龄、爱好、上学方式等）。", answer: "示例：My friend is Li Lei. He is 13 years old. He likes playing basketball. He goes to school by bus. He often helps me with my English.（答案不唯一，语法正确即可）", analysis: "检查：第三人称单数动词加 -s/-es；句子结构完整、信息丰富。" },
  ];

  const chineseQuestions: QDef[] = [
    // C1 字音字形
    { kps: ["C1"], type: "SINGLE_CHOICE", difficulty: 1, stem: "下列加点字的注音有误的一项是（　）", options: ["应和（hé）", "贮蓄（zhù）", "莅临（lì）", "粗犷（guǎng）"], answer: "A", analysis: "「应和」的「和」读 hè，意为声音相应；hé 是「和平」的「和」。" },
    { kps: ["C1"], type: "SINGLE_CHOICE", difficulty: 1, stem: "下列词语中没有错别字的一项是（　）", options: ["嘹亮", "缭亮", "瞭亮", "僚亮"], answer: "A", analysis: "「嘹亮」指声音清脆响亮，声旁为「尞」，其余三项均为错别字。" },
    { kps: ["C1"], type: "FILL_BLANK", difficulty: 1, stem: "根据拼音写汉字：静 mì，mì 写作 ______。", answer: "谧", analysis: "静谧：安静。出自《雨的四季》「读读写写」。" },
    { kps: ["C1"], type: "FILL_BLANK", difficulty: 2, stem: "根据拼音写汉字：翻来 fù 去，fù 写作 ______。", answer: "覆", analysis: "翻来覆去：来回翻动身体，形容多次重复。出自《秋天的怀念》。" },
    // C2 词语运用
    { kps: ["C2"], type: "SINGLE_CHOICE", difficulty: 2, stem: "下列句子中加点成语使用恰当的一项是（　）", options: ["同学们在讨论会上各抒己见，气氛热烈。", "他上课经常迟到，老师对此感到不以为然。", "这部小说情节跌宕起伏，读起来索然无味。", "教室里人声鼎沸，同学们都在安静地读书。"], answer: "A", analysis: "A 各抒己见：各人充分发表自己的意见，恰当；B 不以为然指不认为是对的，与语境不符；C 索然无味与「跌宕起伏」矛盾；D 人声鼎沸与「安静」矛盾。" },
    { kps: ["C2"], type: "SINGLE_CHOICE", difficulty: 2, stem: "依次填入下列横线处的词语，最恰当的一项是（　）校园里______着春天的气息，同学们______在知识的海洋中。", options: ["弥漫 遨游", "弥漫 游玩", "布满 遨游", "充满 游泳"], answer: "A", analysis: "「弥漫」指充满、布满（气体、气息等），「遨游」指远游、畅游，常用于抽象的「知识的海洋」。" },
    { kps: ["C2"], type: "SINGLE_CHOICE", difficulty: 2, stem: "下列句子中加点的词语使用不恰当的一项是（　）", options: ["春天像小姑娘，花枝招展的，笑着，走着。", "雨后的空气格外清新，让人神清气爽。", "他在比赛中发挥失常，成绩一落千丈。", "这个问题很简单，我却回答错了，真是喜出望外。"], answer: "D", analysis: "喜出望外：遇到出乎意料的喜事而特别高兴，回答错题不是喜事，用词不当。" },
    { kps: ["C2"], type: "FILL_BLANK", difficulty: 2, stem: "______ 天气多么恶劣，他都坚持锻炼。（填关联词）", answer: "无论|不管", analysis: "与后文「都」搭配，表示条件关系，用「无论……都」或「不管……都」。" },
    // C3 病句辨析与修改
    { kps: ["C3"], type: "SINGLE_CHOICE", difficulty: 2, stem: "下列句子中没有语病的一项是（　）", options: ["通过这次活动，使我明白了团结的重要性。", "能否刻苦学习，是取得好成绩的关键。", "我们要养成上课认真听讲的好习惯。", "春天的西湖是一个美丽的季节。"], answer: "C", analysis: "A 缺主语（「通过……使」连用）；B 两面对一面（能否……关键）；D 搭配不当（西湖是季节）。" },
    { kps: ["C3"], type: "SINGLE_CHOICE", difficulty: 3, stem: "下列句子中有语病的一项是（　）", options: ["为了防止这类事故再次发生，学校加强了安全教育。", "这次考试的成绩，取决于我们平时的努力程度。", "大约有五十名左右的同学参加了比赛。", "他不但学习好，而且乐于帮助同学。"], answer: "C", analysis: "C「大约」与「左右」语义重复，删去其一。" },
    { kps: ["C3"], type: "SINGLE_CHOICE", difficulty: 3, stem: "下列句子中没有语病的一项是（　）", options: ["同学们讨论并听取了校长的报告。", "这本书的内容和插图都很美丽。", "学校开展了一系列的读书活动，深受同学们欢迎。", "能否坚持锻炼，是身体健康的保证。"], answer: "C", analysis: "A 语序不当（应先听取后讨论）；B 搭配不当（内容与美丽不搭配）；D 两面对一面。" },
    { kps: ["C3"], type: "FILL_BLANK", difficulty: 3, stem: "修改病句（直接写出修改后的句子）：在老师的教育下，使我认识到了自己的错误。", answer: "老师的教育使我认识到了自己的错误|在老师的教育下，我认识到了自己的错误", analysis: "原句缺主语：「在……下」与「使」连用导致主语残缺，删去其一即可。" },
    // C4 古诗文默写
    { kps: ["C4"], type: "FILL_BLANK", difficulty: 1, stem: "《观沧海》中描写大海水波动荡、山岛高耸的句子是：______。", answer: "水何澹澹，山岛竦峙", analysis: "出自曹操《观沧海》，注意「澹澹」「竦峙」的字形。" },
    { kps: ["C4"], type: "FILL_BLANK", difficulty: 1, stem: "《次北固山下》中蕴含新旧交替哲理的千古名句是：______。", answer: "海日生残夜，江春入旧年", analysis: "出自王湾《次北固山下》，以景寓理：新事物孕育于旧事物之中。" },
    { kps: ["C4"], type: "FILL_BLANK", difficulty: 2, stem: "《论语》十二章中论述学习与思考辩证关系的句子是：______。", answer: "学而不思则罔，思而不学则殆", analysis: "出自《论语·为政》，「罔」是迷惑，「殆」是疑惑。" },
    { kps: ["C4"], type: "SINGLE_CHOICE", difficulty: 2, stem: "下列句子与原文一致的一项是（　）", options: ["日月之行，若出其里；星汉灿烂，若出其中。", "潮平两岸阔，风正一帆悬。", "学而时习之，不亦乐乎？", "夕阳西下，断肠人在天崖。"], answer: "B", analysis: "A 前后句颠倒（原文：日月之行，若出其中；星汉灿烂，若出其里）；C 原文为「不亦说乎」；D「天崖」应为「天涯」。" },
    // C5 课内文言文阅读
    { kps: ["C5"], type: "SINGLE_CHOICE", difficulty: 2, stem: "《咏雪》中，面对谢道韫「未若柳絮因风起」的比喻，谢太傅的反应是（　）", options: ["拍案叫绝", "大笑乐", "当场否定", "沉默不语"], answer: "B", analysis: "原文「公大笑乐」。谢太傅未直接表态，但文末特意点明谢道韫身份，可见作者的赞赏之意。" },
    { kps: ["C5"], type: "SINGLE_CHOICE", difficulty: 3, stem: "下列对《陈太丘与友期行》的理解不正确的一项是（　）", options: ["友人过了中午才到，是无信的表现。", "元方「入门不顾」表现出他坚持原则、刚直的一面。", "友人下车引之，是真心悔过的表现。", "文章通过元方之口，讽刺了陈太丘的失信。"], answer: "D", analysis: "文章讽刺的是友人的失信与无礼，而非陈太丘；D 张冠李戴。" },
    { kps: ["C5"], type: "FILL_BLANK", difficulty: 2, stem: "解释加点词：《陈太丘与友期行》中「与友期行」的「期」意思是 ______。", answer: "约定", analysis: "期：约定。「期行」即相约同行。" },
    { kps: ["C5"], type: "FILL_BLANK", difficulty: 3, stem: "解释加点词：「学而不思则罔」的「罔」意思是 ______。", answer: "迷惑，感到迷茫而无所适从|迷惑", analysis: "罔：迷惑，意思是感到迷茫而无所适从。" },
    // C6 现代文阅读
    { kps: ["C6"], type: "SINGLE_CHOICE", difficulty: 3, stem: "阅读《春》中的句子：「小草偷偷地从土里钻出来，嫩嫩的，绿绿的。」句中「钻」字好在哪里？（　）", options: ["「钻」写出了小草破土而出的顽强生命力，表现春天到来的惊喜。", "「钻」说明小草生长缓慢。", "「钻」不如「长」字准确。", "「钻」说明土地很松软。"], answer: "A", analysis: "「钻」字化静为动，写出小草破土的力量感，「偷偷地」表现其不为人觉察的生机。" },
    { kps: ["C6"], type: "SINGLE_CHOICE", difficulty: 3, stem: "阅读《春》中的句子：「树叶儿却绿得发亮，小草儿也青得逼你的眼。」「逼」字写出了（　）", options: ["雨后小草的绿色浓郁鲜亮，直逼人眼。", "小草让人感到害怕。", "小草长得特别高。", "雨下得非常大。"], answer: "A", analysis: "「逼」字写出小草经春雨洗后绿得浓、亮，极具视觉冲击力。" },
    { kps: ["C6"], type: "FILL_BLANK", difficulty: 3, stem: "《春》结尾把春天比作「刚落地的娃娃」，突出了春天 ______ 的特点。", answer: "新|新生", analysis: "刚落地的娃娃是新的，突出春天「新」的特点（后两个比喻分别突出「美」和「有力」）。" },
    { kps: ["C6"], type: "OPEN_RESPONSE", difficulty: 3, stem: "品读《春》中的句子：「红的像火，粉的像霞，白的像雪。」运用了什么修辞手法？有什么表达效果？请简要分析。", answer: "运用比喻和排比的修辞手法，把桃花、杏花、梨花分别比作火、霞、雪，生动形象地写出了春花色彩的艳丽，句式整齐、节奏鲜明，表达了作者对春天的喜爱与赞美之情。", analysis: "答题要点：修辞手法 + 本体喻体 + 表达效果（生动形象、句式整齐）+ 情感。" },
    // C7 名著与综合性学习
    { kps: ["C7"], type: "SINGLE_CHOICE", difficulty: 1, stem: "《朝花夕拾》的作者是（　）", options: ["鲁迅", "老舍", "冰心", "朱自清"], answer: "A", analysis: "《朝花夕拾》是鲁迅的散文集，收录了《从百草园到三味书屋》等回忆性散文。" },
    { kps: ["C7"], type: "SINGLE_CHOICE", difficulty: 2, stem: "《西游记》中，孙悟空在太上老君的炼丹炉中炼成了（　）", options: ["火眼金睛", "七十二变", "筋斗云", "金箍棒"], answer: "A", analysis: "孙悟空被投入八卦炉中炼了四十九天，炼成了火眼金睛。" },
    // C8 作文基础
    { kps: ["C8"], type: "SINGLE_CHOICE", difficulty: 3, stem: "作文《我的老师》的开头，下列写法最恰当的一项是（　）", options: ["我的老师姓张，她是一位好老师，我很喜欢她。", "在我的记忆深处，有一位老师，像一盏灯，照亮了我成长的每一步。", "老师，就是教我们知识的人。", "我要写我的老师，下面开始写。"], answer: "B", analysis: "B 用比喻点题、设置悬念，有画面感；A 平铺直叙，C 偏离「我的老师」这一具体对象，D 是说明性套话。" },
    { kps: ["C8"], type: "OPEN_RESPONSE", difficulty: 3, stem: "以《秋天来了》为题，写一段 100 字左右的文字，至少运用一种修辞手法，写出你对秋天的感受。", answer: "示例：秋天来了。天空蓝得透明，几朵白云悠闲地飘着。风一吹，金黄的落叶像一只只蝴蝶，在空中翩翩起舞。果园里，苹果涨红了脸，石榴咧开了嘴，空气中满是果实的甜香。秋天，是一个丰收的季节，也是一个让人沉醉的季节。", analysis: "评分要点：扣题、有修辞手法、语言通顺、有自己的感受。" },
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
  await createQuestions(chinese.id, chineseQuestions);

  // ---------- 掌握度（含历史轨迹） ----------
  const mathKps = await prisma.knowledgePoint.findMany({ where: { subjectId: math.id } });
  const engKps = await prisma.knowledgePoint.findMany({ where: { subjectId: english.id } });
  const chiKps = await prisma.knowledgePoint.findMany({ where: { subjectId: chinese.id } });

  // 知识点难度惩罚项（按 code 取，避免依赖查询返回顺序）
  const penaltyByCode = new Map<string, number>();
  for (const d of [...mathKpDefs, ...engKpDefs, ...chiKpDefs]) {
    penaltyByCode.set(d.code, d.penalty ?? 0);
  }

  const mathMasteryMap = new Map<string, Map<string, number>>(); // studentId -> kpId -> value
  const engMasteryMap = new Map<string, Map<string, number>>();
  const chiMasteryMap = new Map<string, Map<string, number>>();

  for (const stu of students) {
    const base = studentBase.get(stu.id)!;
    for (const kp of mathKps) {
      const jitter = (rng() - 0.5) * 0.24;
      const kpPenalty = penaltyByCode.get(kp.code) ?? 0;
      const value = Math.min(0.98, Math.max(0.08, base + jitter + kpPenalty));
      if (!mathMasteryMap.has(stu.id)) mathMasteryMap.set(stu.id, new Map());
      mathMasteryMap.get(stu.id)!.set(kp.id, value);
    }
    for (const kp of engKps) {
      const value = Math.min(0.95, Math.max(0.1, base * 0.75 + (rng() - 0.5) * 0.2));
      if (!engMasteryMap.has(stu.id)) engMasteryMap.set(stu.id, new Map());
      engMasteryMap.get(stu.id)!.set(kp.id, value);
    }
    for (const kp of chiKps) {
      const jitter = (rng() - 0.5) * 0.18;
      const kpPenalty = penaltyByCode.get(kp.code) ?? 0;
      const value = Math.min(0.95, Math.max(0.08, base * 0.8 + jitter + kpPenalty));
      if (!chiMasteryMap.has(stu.id)) chiMasteryMap.set(stu.id, new Map());
      chiMasteryMap.get(stu.id)!.set(kp.id, value);
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
    await seedMastery(stu.id, chiKps, chiMasteryMap.get(stu.id)!);
  }

  // ---------- 演示作业 + 作答 ----------
  const errorTagPool = ["计算失误", "概念混淆", "步骤遗漏", "审题错误"];

  async function seedDemoAssignment(opts: {
    subjectId: string;
    classId: string;
    type: AssignmentType;
    title: string;
    stems: string[];
    masteryMap: Map<string, Map<string, number>>;
  }) {
    const { subjectId, classId, type, title, stems, masteryMap } = opts;
    const questions = await Promise.all(
      stems.map((stem) =>
        prisma.question.findFirstOrThrow({
          where: { subjectId, stem },
        })
      )
    );
    const assignment = await prisma.assignment.create({
      data: {
        subjectId,
        classId,
        type,
        title,
        dueAt: new Date(Date.now() + 3 * DAY),
        questions: {
          create: questions.map((q, i) => ({ questionId: q.id, order: i + 1 })),
        },
      },
    });

    for (const stu of students) {
      const answers = await Promise.all(
        questions.map(async (q) => {
          const kpIds = parseArr(q.kpIds);
          // 以该生对应知识点的掌握度为正确概率（演示数据）
          const kpMastery = Math.max(...kpIds.map((id) => masteryMap.get(stu.id)!.get(id) ?? 0.5));
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
    return assignment;
  }

  const assignment = await seedDemoAssignment({
    subjectId: math.id,
    classId: cls.id,
    type: AssignmentType.HOMEWORK,
    title: "一元一次方程 · 第 1 周作业",
    stems: [
      "已知 3x = 9，则 x 等于（　）",
      "解方程：x + 3 = 8，得 x = ______。",
      "解方程：3x - 2 = 7，得 x = ______。",
      "解方程：2(x + 3) = 14，得 x = ______。",
      "甲、乙两地相距 240 km，一辆汽车从甲地出发，以 60 km/h 的速度匀速行驶，______ 小时后到达乙地。",
    ],
    masteryMap: mathMasteryMap,
  });

  const quiz = await seedDemoAssignment({
    subjectId: chinese.id,
    classId: cls.id,
    type: AssignmentType.QUIZ,
    title: "语文基础 · 第 1 周小测",
    // 只选选择题：错答生成器对填空题按数值加减处理，语文填空题不适合
    stems: [
      "下列词语中没有错别字的一项是（　）",
      "下列句子中加点成语使用恰当的一项是（　）",
      "下列句子中有语病的一项是（　）",
      "下列句子与原文一致的一项是（　）",
      "《咏雪》中，面对谢道韫「未若柳絮因风起」的比喻，谢太傅的反应是（　）",
    ],
    masteryMap: chiMasteryMap,
  });

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
  console.log(`  语文：${chiKpDefs.length} 个知识点，${chineseQuestions.length} 道题`);
  console.log(`  演示作业：${assignment.title}、${quiz.title}（各 10 份作答）`);
  console.log(`  演示账号密码统一为 ${DEMO_PASSWORD}（bcrypt 哈希存储）`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
