/**
 * 端到端闭环验证脚本（开发用，非产品代码）：
 * 教师登录 → 布置作业 → 学生登录 → 在线作答 → 自动批改 → 掌握度更新 → 错题归集 → 教师看板刷新
 * 运行：npx tsx scripts/e2e-test.ts（需 dev server 已在 http://localhost:3000 运行）
 */
import { PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";
import { llmConfigured } from "../lib/llm";
import { cleanupRun, type RunCreated } from "./e2e-cleanup";

const BASE = "http://localhost:3000";
const prisma = new PrismaClient();

// 本轮创建的作业/目标/分享链接：结束后（无论成败）由 cleanupRun 删除并恢复该生统计，
// 避免测试数据残留线上共享库（作业/目标/提交/掌握度/错题本都被真实账号污染）。
let createdState: RunCreated | null = null;

class Session {
  cookies = new Map<string, string>();

  apply(res: Response) {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) this.cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
  }

  get cookieHeader() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  async fetch(path: string, init?: RequestInit) {
    const res = await fetch(BASE + path, {
      ...init,
      headers: {
        Cookie: this.cookieHeader,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    });
    this.apply(res);
    return res;
  }

  async login(userId: string, password = "123456") {
    const csrfRes = await this.fetch("/api/auth/csrf");
    const { csrfToken } = await csrfRes.json();
    const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
      method: "POST",
      headers: {
        Cookie: this.cookieHeader,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        csrfToken,
        userId,
        password,
        json: "true",
      }).toString(),
      redirect: "manual",
    });
    this.apply(res);
    const j = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    // 密码错时 next-auth 返回 200 + 带 error 参数的 url（不返回 error 字段、也不抛 4xx），
    // 只判 j.error 会把失败当成功，症状是「登录没报错、后续请求全 401」。
    // 以是否真拿到 session cookie 为准。
    const token = [...this.cookies.keys()].find((k) => k.endsWith("session-token"));
    if (j.error || !token || (j.url ?? "").includes("error=")) {
      throw new Error(`登录失败: ${j.error ?? j.url ?? "未拿到 session cookie"}`);
    }
    return j;
  }
}

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

/**
 * 共享 Neon 库是多人共用的，常有组员自建账号（密码不是 123456）。
 * `findFirst({ role })` 可能选中这类账号，导致第 1 组登录就 401、整轮跑不完。
 * 这里按「能否用默认密码登录」逐个探测，选第一个能登上的账号。
 */
async function findLoginable(role: "TEACHER" | "ADMIN") {
  const candidates = await prisma.user.findMany({ where: { role }, select: { id: true, name: true } });
  for (const u of candidates) {
    try {
      await new Session().login(u.id);
      return u;
    } catch {
      // 换下一个候选
    }
  }
  throw new Error(
    `没有能用默认密码（123456）登录的 ${role} 账号；候选：${
      candidates.map((c) => c.name).join("、") || "（该库无此类账号，请先 npx prisma db seed）"
    }`
  );
}

async function main() {
  const teacher = await findLoginable("TEACHER");
  const student = await prisma.user.findFirstOrThrow({
    where: { role: "STUDENT", classId: { not: null } },
    orderBy: { name: "asc" },
  });
  const math = await prisma.subject.findUniqueOrThrow({ where: { code: "math" } });
  const english = await prisma.subject.findUniqueOrThrow({ where: { code: "english" } });
  const chinese = await prisma.subject.findUniqueOrThrow({ where: { code: "chinese" } });
  const cls = await prisma.class.findUniqueOrThrow({ where: { id: student.classId! } });
  const kps = await prisma.knowledgePoint.findMany({ where: { subjectId: math.id } });
  const runStart = new Date();
  createdState = {
    studentId: student.id,
    assignmentIds: [],
    goalIds: [],
    shareLinkIds: [],
    notificationBoundary: runStart,
    notificationUserIds: [student.id],
  };

  console.log(`\n== 1. 教师 ${teacher.name} 登录 ==`);
  const t = new Session();
  await t.login(teacher.id);

  console.log("\n== 2. 教师布置作业 ==\n（题库选题）");
  const qRes = await t.fetch(`/api/questions?subject=math`);
  assert(qRes.ok, `题库接口 ${qRes.status}`);
  const bank: { id: string; kpIds: string[]; stem: string; answer: string; type: string }[] = await qRes.json();
  assert(bank.length >= 10, `题库题目数 >= 10（实际 ${bank.length}）`);
  // 至少含一道选择题（讲评选项分布断言用；其余任选，题库前几题未必是选择题）
  const firstChoice = bank.find((q) => q.type === "SINGLE_CHOICE") ?? bank[0];
  const picked = [firstChoice, ...bank.filter((q) => q.id !== firstChoice.id).slice(0, 3)];
  const aRes = await t.fetch("/api/assignments", {
    method: "POST",
    body: JSON.stringify({
      title: "E2E 闭环验证作业",
      type: "HOMEWORK",
      subjectId: math.id,
      classId: cls.id,
      questionIds: picked.map((q) => q.id),
    }),
  });
  assert(aRes.status === 201, `布置作业 ${aRes.status}`);
  const { id: assignmentId } = await aRes.json();
  createdState!.assignmentIds.push(assignmentId);

  console.log("\n== 3. 学生 " + student.name + " 登录 ==");
  const s = new Session();
  await s.login(student.id);

  console.log("\n== 4. 学生在任务中心看到新作业 ==");
  const listRes = await s.fetch(`/api/assignments?subject=math`);
  const list = (await listRes.json()) as {
    id: string;
    mySubmissionId: string | null;
  }[];
  const mine = list.find((a) => a.id === assignmentId);
  assert(mine && !mine.mySubmissionId, "新作业出现在待完成列表");

  console.log("\n== 5. 学生在线作答并提交（第 1 题答对，其余答错） ==");
  const detailRes = await s.fetch(`/api/assignments/${assignmentId}`);
  const detail = await detailRes.json();
  assert(detailRes.ok, `作业详情 ${detailRes.status}`);
  assert(!detail.mySubmission, "提交前不可见答案（mySubmission 为 null）");
  assert(detail.questions.every((q: { answer?: string }) => q.answer === undefined), "提交前题目不含标准答案");

  const beforeMastery = await prisma.mastery.findMany({
    where: { studentId: student.id, kpId: { in: kps.map((k) => k.id) } },
  });
  const before = new Map(beforeMastery.map((m) => [m.kpId, m.value]));

  const submitRes = await s.fetch(`/api/assignments/${assignmentId}/submit`, {
    method: "POST",
    body: JSON.stringify({
      answers: detail.questions.map((q: { id: string }, i: number) => ({
        questionId: q.id,
        response: i === 0 ? picked[0].answer : "错误答案",
        timeSpentMs: 45000 + i * 10000,
      })),
    }),
  });
  assert(submitRes.status === 201, `提交作答 ${submitRes.status}`);
  const submitResult = await submitRes.json();
  const results: {
    isCorrect: boolean | null;
    score: number | null;
    errorTags: string[];
  }[] = submitResult.results;
  assert(results.length === 4, "批改返回 4 条结果");
  assert(results[0].isCorrect === true && results[0].score === 1, "第 1 题判为正确");
  assert(
    results.slice(1).every((r) => r.isCorrect === false && r.score === 0),
    "其余 3 题判为错误"
  );
  const mastery = submitResult.mastery as Record<string, number>;
  assert(Object.keys(mastery).length > 0, `掌握度更新返回 ${Object.keys(mastery).length} 个知识点`);
  for (const [kpId, v] of Object.entries(mastery)) {
    assert(v >= 0 && v <= 1, `掌握度 ${kpId} 在 0-1 范围（${v}）`);
  }

  console.log("\n== 6. 掌握度已更新（6:4 加权） ==");
  const afterMastery = await prisma.mastery.findMany({
    where: { studentId: student.id, kpId: { in: kps.map((k) => k.id) } },
  });
  const after = new Map(afterMastery.map((m) => [m.kpId, m.value]));
  let changed = 0;
  for (const [kpId, prev] of before) {
    if (Math.abs((after.get(kpId) ?? 0) - prev) > 1e-9) changed++;
  }
  assert(changed >= 1, `掌握度发生变化（${changed} 个知识点）`);

  console.log("\n== 7. 错题归集 ==");
  const wqRes = await s.fetch(`/api/wrong-questions?subject=math`);
  const wqs: { questionId: string }[] = await wqRes.json();
  const wrongFromThis = picked
    .slice(1)
    .filter((q) => wqs.some((w) => w.questionId === q.id));
  assert(wrongFromThis.length === 3, `3 道错题进入错题本（实际 ${wrongFromThis.length}）`);

  console.log("\n== 8. 提交后可见答案与批改 ==");
  const afterDetailRes = await s.fetch(`/api/assignments/${assignmentId}`);
  const afterDetail = await afterDetailRes.json();
  assert(afterDetail.mySubmission, "mySubmission 存在");
  assert(
    afterDetail.questions.every((q: { answer?: string }) => q.answer !== undefined),
    "提交后题目含标准答案"
  );

  console.log("\n== 9. 教师看板刷新（含新提交） ==");
  const dashRes = await t.fetch(`/api/teacher/dashboard?subject=math&classId=${cls.id}`);
  assert(dashRes.ok, `看板接口 ${dashRes.status}`);
  const dash = await dashRes.json();
  const classSize = await prisma.user.count({ where: { role: "STUDENT", classId: cls.id } });
  assert(
    dash.students.length === classSize,
    `看板包含本班 ${classSize} 名学生（实际 ${dash.students.length}）`
  );
  assert(dash.stats.submissionRate > 0, `提交率 > 0（实际 ${dash.stats.submissionRate}%）`);
  const wf = dash.students.find((x: { name: string }) => x.name === student.name);
  assert(wf && wf.tier, `${student.name} 在看板中有分层（${wf.tier}）`);
  assert(
    typeof (wf as { studentNo?: unknown } | undefined)?.studentNo === "string" ||
      (wf as { studentNo?: unknown } | undefined)?.studentNo === null,
    "看板学生带 studentNo 字段（string 或 null）"
  );

  console.log("\n== 10. 学生图谱 / 学习路径 / 成长档案 / 目标 ==");
  const pathRes = await s.fetch(`/api/student/path?subject=math`);
  assert(pathRes.ok, `学习路径 ${pathRes.status}`);
  const pathData = await pathRes.json();
  assert(Array.isArray(pathData.items), "学习路径返回拓扑序列");
  const growthRes = await s.fetch(`/api/growth?subject=math`);
  const growth = await growthRes.json();
  assert(growthRes.ok && Array.isArray(growth.badges), "成长档案返回徽章");
  const goalRes = await s.fetch("/api/goals", {
    method: "POST",
    body: JSON.stringify({ content: "E2E 验证目标：本周完成 10 道练习" }),
  });
  assert(goalRes.status === 201, `目标设定 ${goalRes.status}`);
  createdState!.goalIds.push(((await goalRes.json()) as { id: string }).id);

  console.log("\n== 11. 重复提交被拒绝（演示规则） ==");
  const dupRes = await s.fetch(`/api/assignments/${assignmentId}/submit`, {
    method: "POST",
    body: JSON.stringify({
      answers: detail.questions.map((q: { id: string }) => ({ questionId: q.id, response: "x" })),
    }),
  });
  assert(dupRes.status === 400, `重复提交返回 400（实际 ${dupRes.status}）`);

  console.log("\n== 12. 权限校验 ==");
  const sForbidden = await s.fetch("/api/teacher/dashboard?subject=math");
  assert(sForbidden.status === 403, `学生访问教师接口被拒 ${sForbidden.status}`);
  const tForbidden = await t.fetch("/api/student/path?subject=math");
  assert(tForbidden.status === 403, `教师访问学生接口被拒 ${tForbidden.status}`);

  console.log("\n== 13. F1 批改置信度与复核队列 ==");
  const orRes = await t.fetch(`/api/questions?subject=math&type=OPEN_RESPONSE`);
  const orBank: { id: string; kpIds: string[] }[] = await orRes.json();
  assert(orBank.length > 0, `题库有解答题（${orBank.length} 道）`);
  const orQ = orBank[0];
  const orA = await t.fetch("/api/assignments", {
    method: "POST",
    body: JSON.stringify({
      title: "E2E 复核队列验证作业",
      type: "HOMEWORK",
      subjectId: math.id,
      classId: cls.id,
      questionIds: [orQ.id],
    }),
  });
  assert(orA.status === 201, `布置解答题作业 ${orA.status}`);
  const orAssignmentId = (await orA.json()).id as string;
  createdState!.assignmentIds.push(orAssignmentId);
  const orSubmit = await s.fetch(`/api/assignments/${orAssignmentId}/submit`, {
    method: "POST",
    body: JSON.stringify({
      answers: [{ questionId: orQ.id, response: "步骤省略，直接写结果 42", timeSpentMs: 60000 }],
    }),
  });
  assert(orSubmit.status === 201, `解答题提交 ${orSubmit.status}`);
  const orResult = (await orSubmit.json()) as {
    results: { isCorrect: boolean | null; score: number | null; confidence: number | null; reviewStatus: string }[];
  };
  const g = orResult.results[0];
  if (!llmConfigured()) {
    assert(g.isCorrect === null && g.confidence === null, "未配 Key 时解答题为待批改（null/null）");
    assert(g.reviewStatus === "needs_review", "reviewStatus 为 needs_review");
    const q1 = await t.fetch(`/api/review-queue?classId=${cls.id}`);
    const q1j = await q1.json();
    const inQueue = (q1j.items ?? []).find(
      (x: { studentName: string; assignmentTitle: string }) =>
        x.assignmentTitle === "E2E 复核队列验证作业"
    );
    assert(Boolean(inQueue), "待复核队列中出现该作答");
    // 教师改判：判错 0.3 分 → 写库 + 联动掌握度/错题本
    const ov = await t.fetch("/api/review-queue", {
      method: "POST",
      body: JSON.stringify({
        recordId: inQueue.id,
        action: "override",
        isCorrect: false,
        score: 0.3,
        errorAnalysis: "E2E 复核说明",
      }),
    });
    assert(ov.status === 200, `改判落库 ${ov.status}`);
    const ovj = await ov.json();
    assert(
      Object.keys(ovj.mastery ?? {}).length > 0,
      `改判联动掌握度（${Object.keys(ovj.mastery ?? {}).length} 个知识点）`
    );
    const rec = await prisma.answerRecord.findUniqueOrThrow({ where: { id: inQueue.id } });
    assert(rec.reviewStatus === "reviewed" && rec.isCorrect === false, "记录已复核且判错");
    assert(Math.abs((rec.score ?? 0) - 0.3) < 1e-9, "分数已写为 0.3");
    const wq = await prisma.wrongQuestion.findUnique({
      where: { studentId_questionId: { studentId: student.id, questionId: orQ.id } },
    });
    assert(Boolean(wq), "改判为错后进入错题本");
    const q2 = await t.fetch(`/api/review-queue?classId=${cls.id}`);
    const q2j = await q2.json();
    assert(
      !(q2j.items ?? []).some((x: { id: string }) => x.id === inQueue.id),
      "复核后从队列移除"
    );
    // AI 重批（无 Key）：不写库，persisted=false
    const rg = await t.fetch("/api/ai/grade", {
      method: "POST",
      body: JSON.stringify({ questionId: orQ.id, response: "步骤省略", answerRecordId: inQueue.id }),
    });
    assert(rg.status === 200, `AI 重批接口 ${rg.status}`);
    const rgj = await rg.json();
    assert(rgj.persisted === false, "无 Key 时 AI 重批不写库（persisted=false）");
    // 通知：改判 → 学生收到 reviewed 通知
    const noti13 = (await (await s.fetch("/api/notifications")).json()) as {
      items: { type: string; link: string | null }[];
    };
    assert(
      noti13.items.some((x) => x.type === "reviewed" && (x.link ?? "").includes(orAssignmentId)),
      "改判后学生收到批改复核通知"
    );
  } else {
    console.log("  （已配置 LLM Key，跳过无 Key 分支断言；解答题走 AI 批改路径）");
  }

  console.log("\n== 14. F4 应用内一键演示数据 ==");
  const admin = await findLoginable("ADMIN");
  const ad = new Session();
  await ad.login(admin.id);
  // 共享库可能残留其他会话未清除的演示数据（生成器会先清一遍），
  // 因此「生成前后待复核数」只用非演示来源的数量做基准，避免残留演示数据干扰断言。
  const nonDemoPending = await prisma.answerRecord.count({
    where: { reviewStatus: "needs_review", submission: { assignment: { source: { not: "demo" } } } },
  });

  // 生成量 = 轮数 × 班级人数，班级人数随共享库漂移（组员增删过学生），
  // 所以期望值按「生成器会选中的那 3 个班」的实际人数推导，不写死 450/1350/240。
  const rounds = 5;
  const demoClasses = (
    await prisma.class.findMany({
      include: { _count: { select: { students: { where: { role: "STUDENT" } } } } },
    })
  )
    .filter((c) => c._count.students > 0)
    .slice(0, 3);
  const demoStudents = demoClasses.reduce((n, c) => n + c._count.students, 0);
  assert(demoClasses.length === 3 && demoStudents > 0, `可推导演示规模：${demoClasses.length} 班 / ${demoStudents} 人`);

  const gen = await ad.fetch("/api/demo", { method: "POST", body: JSON.stringify({ mode: "generate" }) });
  assert(gen.status === 200, `生成演示数据 ${gen.status}`);
  const genJ = (await gen.json()) as {
    mode: string;
    classes: number;
    classNames: string[];
    assignments: number;
    submissions: number;
    answers: number;
    pendingReview: number;
    timeline: { label: string; classAvg: number }[];
  };
  assert(genJ.mode === "generate", "generate 响应 mode 正确");
  assert(genJ.classes === demoClasses.length, `覆盖 ${demoClasses.length} 个班级（实际 ${genJ.classes}）`);
  assert(
    genJ.classNames.length === demoClasses.length &&
      genJ.classNames.every((n) => demoClasses.some((c) => c.name === n)),
    `返回班级名单与推导一致（${genJ.classNames.join("、")}）`
  );
  assert(genJ.timeline.length === 5, `回放时间线 5 帧（实际 ${genJ.timeline.length}）`);
  assert(
    genJ.timeline.every((t, i) => t.label === `第 ${i + 1} 周` && t.classAvg >= 0 && t.classAvg <= 1),
    "时间线帧标签与 classAvg 范围正确"
  );
  assert(
    genJ.assignments === rounds * demoClasses.length,
    `生成 ${rounds * demoClasses.length} 份演示作业（实际 ${genJ.assignments}）`
  );
  assert(
    genJ.submissions === rounds * demoStudents,
    `生成 ${rounds * demoStudents} 份提交（= ${rounds} 轮 × ${demoStudents} 人，实际 ${genJ.submissions}）`
  );
  // 每次作业每生可见题 = 2 道无层级题 + 1 道本层级题
  assert(genJ.answers === 3 * genJ.submissions, `每份提交 3 条作答（实际 ${genJ.answers}/${genJ.submissions}）`);
  // 解答题每班 2-3 轮各 1 道，且恒为可见（tier 为空）；所有解答题作答都进待复核
  assert(
    genJ.pendingReview >= 2 * demoStudents && genJ.pendingReview <= 3 * demoStudents,
    `待复核 = 解答题作答，落在 [2×${demoStudents}, 3×${demoStudents}] 内（实际 ${genJ.pendingReview}）`
  );

  const demoAsg = await prisma.assignment.count({ where: { source: "demo" } });
  assert(demoAsg === genJ.assignments, `DB 中 demo 作业 ${genJ.assignments} 份（实际 ${demoAsg}）`);
  const demoPts = await prisma.masteryPoint.count({ where: { source: "demo" } });
  assert(demoPts > 0, `DB 中 demo 掌握度历史点 ${demoPts} 个`);
  const demoAns = await prisma.answerRecord.count({
    where: { submission: { assignment: { source: "demo" } } },
  });
  assert(demoAns === genJ.answers, `DB 中演示作答条数与响应一致（${demoAns}）`);
  const needsReview = await prisma.answerRecord.count({ where: { reviewStatus: "needs_review" } });
  assert(
    needsReview === nonDemoPending + genJ.pendingReview,
    `DB 中待复核 = 非演示 ${nonDemoPending} + 演示 ${genJ.pendingReview}（实际 ${needsReview}）`
  );
  const qGen = await (await t.fetch(`/api/review-queue?countOnly=1`)).json();
  assert(
    Number(qGen.count) === nonDemoPending + genJ.pendingReview,
    `复核队列含演示待复核项（${qGen.count}）`
  );

  // 幂等：重复生成不翻倍
  const gen2 = await ad.fetch("/api/demo", { method: "POST", body: JSON.stringify({ mode: "generate" }) });
  assert(gen2.status === 200, `重复生成 ${gen2.status}`);
  const gen2J = await gen2.json();
  assert(gen2J.assignments === genJ.assignments, "重复生成后作业数不变（幂等）");
  assert(
    (await prisma.assignment.count({ where: { source: "demo" } })) === genJ.assignments,
    "DB 中 demo 作业未翻倍"
  );

  // 隔离：真实作业不受影响
  const realAsg = await prisma.assignment.findUnique({ where: { id: assignmentId } });
  assert(Boolean(realAsg) && realAsg!.source === null, "E2E 真实作业仍在且无 source 标记");

  // 清除：demo 数据归零、队列恢复、掌握度回退由 test-demo 覆盖
  const clear = await ad.fetch("/api/demo", { method: "POST", body: JSON.stringify({ mode: "clear" }) });
  assert(clear.status === 200, `清除演示数据 ${clear.status}`);
  const clearJ = await clear.json();
  assert(clearJ.mode === "clear" && clearJ.cleared === true, "clear 响应正确");
  assert((await prisma.assignment.count({ where: { source: "demo" } })) === 0, "DB 中 demo 作业已清零");
  assert((await prisma.masteryPoint.count({ where: { source: "demo" } })) === 0, "demo 掌握度历史点已清零");
  const qAfter = await (await t.fetch(`/api/review-queue?countOnly=1`)).json();
  assert(Number(qAfter.count) === nonDemoPending, `复核队列恢复（${qAfter.count}）`);
  assert(Boolean(await prisma.assignment.findUnique({ where: { id: assignmentId } })), "清除后真实作业仍在");

  console.log("\n== 15. F2 变式补救作业 ==");
  const kpsRes = await t.fetch(`/api/remedial/kps?subject=math&classId=${cls.id}`);
  assert(kpsRes.status === 200, `补救知识点聚合 ${kpsRes.status}`);
  const kpsJ = (await kpsRes.json()) as { items: { kpId: string; code: string; wrongCount: number; studentCount: number }[] };
  assert(Array.isArray(kpsJ.items), "聚合返回 items 数组");
  if (kpsJ.items.length) {
    const [first] = kpsJ.items;
    assert(first.wrongCount > 0 && first.studentCount > 0, `首项 ${first.code} 有错题数据（${first.studentCount} 人 ${first.wrongCount} 次）`);
    const sortedOk = kpsJ.items.every(
      (x, i, arr) => i === 0 || arr[i - 1].studentCount >= x.studentCount
    );
    assert(sortedOk, "聚合按涉及学生数降序");
    const genRes = await t.fetch("/api/remedial/generate", {
      method: "POST",
      body: JSON.stringify({ subjectCode: "math", kpIds: [first.kpId], perKp: 1, tier: "auto", classId: cls.id }),
    });
    const genJ = await genRes.json();
    if (!llmConfigured()) {
      assert(genRes.status === 502, `无 Key 时生成返回 502（实际 ${genRes.status}）`);
      assert(String(genJ.error ?? "").includes("未配置"), "错误信息提示未配置 API Key");
    } else {
      assert(genRes.status === 200 && Array.isArray(genJ.questions) && genJ.questions.length > 0, "生成返回题目列表");
      for (const q of genJ.questions as { kpId: string; tier: string }[]) {
        assert(q.kpId === first.kpId, `题目关联所选知识点（${q.kpId}）`);
        assert(["foundation", "intermediate", "advanced"].includes(q.tier), `题目带合法层级（${q.tier}）`);
      }
    }
  } else {
    console.log("  （该班暂无未攻克错题，跳过聚合细节断言）");
  }

  console.log("\n== 17. 分层升降建议与一键采纳 ==");
  const tierRes = await t.fetch(`/api/teacher/tiers?subject=math&classId=${cls.id}`);
  assert(tierRes.status === 200, `分层建议接口 ${tierRes.status}`);
  const tierJ = (await tierRes.json()) as {
    items: { studentId: string; name: string; currentTier: string; suggestedTier: string; advice: { summary: string } }[];
    pinned: { id: string; name: string; tierOverride: string | null }[];
    aiGenerated: boolean;
  };
  assert(Array.isArray(tierJ.items), "返回 items 数组");
  assert(Array.isArray(tierJ.pinned), "返回 pinned 数组");
  for (const it of tierJ.items) {
    assert(typeof it.advice?.summary === "string" && it.advice.summary.length > 0, `候选 ${it.name} 有建议文本`);
    assert(["foundation", "intermediate", "advanced"].includes(it.suggestedTier), `候选 ${it.name} 目标层级合法`);
  }
  if (!llmConfigured()) assert(tierJ.aiGenerated === false, "无 Key 时 aiGenerated=false");

  // 采纳：给 e2e 学生锁定一个与其自动分层不同的层
  const dash1 = (await (await t.fetch(`/api/teacher/dashboard?subject=math&classId=${cls.id}`)).json()) as {
    students: { id: string; name: string; tier: string; tierOverride: string | null }[];
  };
  const me1 = dash1.students.find((x) => x.id === student.id);
  assert(me1 && !me1.tierOverride, "e2e 学生初始无锁定");
  const targetTier = me1!.tier === "foundation" ? "intermediate" : "foundation";
  const adopt = await t.fetch("/api/teacher/tiers", {
    method: "POST",
    body: JSON.stringify({ items: [{ studentId: student.id, tier: targetTier }] }),
  });
  assert(adopt.status === 200, `采纳分层 ${adopt.status}`);
  const dbMe = await prisma.user.findUnique({ where: { id: student.id } });
  assert(dbMe?.tierOverride === targetTier, `DB tierOverride=${targetTier}（实际 ${dbMe?.tierOverride}）`);

  const dash2 = (await (await t.fetch(`/api/teacher/dashboard?subject=math&classId=${cls.id}`)).json()) as {
    students: { id: string; name: string; tier: string; tierOverride: string | null }[];
  };
  const me2 = dash2.students.find((x) => x.id === student.id);
  assert(me2 && me2.tier === targetTier && me2.tierOverride === targetTier, "看板有效分层=锁定值");

  const asgDetail = (await (await s.fetch(`/api/assignments/${assignmentId}`)).json()) as { myTier: string | null };
  assert(asgDetail.myTier === targetTier, `学生端 myTier=${targetTier}（锁定生效）`);

  // 清除锁定 → 恢复自动分层
  const clearTier = await t.fetch("/api/teacher/tiers", {
    method: "POST",
    body: JSON.stringify({ items: [{ studentId: student.id, tier: null }] }),
  });
  assert(clearTier.status === 200, `清除锁定 ${clearTier.status}`);
  const dash3 = (await (await t.fetch(`/api/teacher/dashboard?subject=math&classId=${cls.id}`)).json()) as {
    students: { id: string; name: string; tier: string; tierOverride: string | null }[];
  };
  const me3 = dash3.students.find((x) => x.id === student.id);
  assert(me3 && me3.tier === me1!.tier && me3.tierOverride === null, "清除后恢复自动分层");

  console.log("\n== 18. AI 班级学情周报 ==");
  const wrRes = await t.fetch("/api/ai/weekly-report", {
    method: "POST",
    body: JSON.stringify({ subjectCode: "math", classId: cls.id }),
  });
  assert(wrRes.status === 200, `周报接口 ${wrRes.status}`);
  const wrJ = (await wrRes.json()) as {
    report: { title: string; summary: string; suggestions: string[]; aiGenerated: boolean };
    stats: {
      range: { current: { from: string }; previous: { to: string } };
      submissionRate: { current: number | null; previous: number | null };
      masteryTrend: { date: string; avg: number }[];
      tierDistribution: Record<string, number>;
    };
  };
  assert(typeof wrJ.report?.title === "string" && wrJ.report.title.length > 0, "周报有标题");
  assert(typeof wrJ.report?.summary === "string" && wrJ.report.summary.length > 0, "周报有总结文本");
  assert(Array.isArray(wrJ.report?.suggestions), "周报含建议数组");
  const sr = wrJ.stats.submissionRate;
  assert(sr.current === null || (sr.current >= 0 && sr.current <= 1), "提交率 0-1 或 null");
  assert(new Date(wrJ.stats.range.current.from) >= new Date(wrJ.stats.range.previous.to), "窗口顺序正确（本期在前）");
  assert(["foundation", "intermediate", "advanced"].every((t) => t in wrJ.stats.tierDistribution), "分层分布三档齐全");
  if (!llmConfigured()) assert(wrJ.report.aiGenerated === false, "无 Key 时模板兜底 aiGenerated=false");
  const wrForbidden = await s.fetch("/api/ai/weekly-report", {
    method: "POST",
    body: JSON.stringify({ subjectCode: "math", classId: cls.id }),
  });
  assert(wrForbidden.status === 403, `学生会话调用周报被拒（实际 ${wrForbidden.status}）`);

  console.log("\n== 19. 家长只读分享链接 ==");
  const mk = await t.fetch("/api/teacher/share-links", {
    method: "POST",
    body: JSON.stringify({ studentId: student.id }),
  });
  assert(mk.status === 201, `创建分享链接 ${mk.status}`);
  const mkJ = (await mk.json()) as { link: { id: string; url: string } };
  const raw = (mkJ.link?.url ?? "").split("/").pop() ?? "";
  assert(/^[A-Za-z0-9_-]{32}$/.test(raw), `token 为 32 字符 base64url（实际 ${raw.length}）`);
  const dbLink = await prisma.shareLink.findFirst({ where: { studentId: student.id }, orderBy: { createdAt: "desc" } });
  assert(dbLink && dbLink.tokenHash.length === 64 && dbLink.tokenHash !== raw, "DB 存 64 位 sha256 哈希且不等于 raw");
  createdState!.shareLinkIds.push(dbLink!.id);

  // 无 cookie 的裸会话公开访问（无需登录）
  const pub = new Session();
  const pubRes = await pub.fetch(`/api/share/${raw}`);
  assert(pubRes.status === 200, `公开访问分享数据 ${pubRes.status}`);
  // 分享页（HTML）同样公开可访问（页面为客户端渲染，内容由 /api/share 提供）
  const pubPage = await pub.fetch(mkJ.link.url);
  assert(pubPage.status === 200, `公开访问分享页 ${pubPage.status}`);
  const pubJ = (await pubRes.json()) as {
    student: { name: string };
    subjects: { code: string; name: string }[];
    goals: unknown[];
    bySubject: {
      subject: { code: string };
      tier: string;
      stats: { submissions: number };
      trend: unknown[];
      badges: unknown[];
      radar: { indicators: unknown[]; values: number[] };
    }[];
  };
  assert(pubJ.student?.name === student.name, "分享数据含学生姓名");
  assert(Array.isArray(pubJ.subjects) && pubJ.subjects.length > 0, "含科目列表");
  assert(Array.isArray(pubJ.goals), "含目标列表");
  const bs0 = pubJ.bySubject?.[0];
  assert(bs0 && typeof bs0.stats.submissions === "number", "含统计卡片数据");
  assert(Array.isArray(bs0.trend) && Array.isArray(bs0.badges), "含趋势与徽章");
  assert(bs0.radar && bs0.radar.indicators.length === bs0.radar.values.length, "雷达指标与值对齐");
  assert(["foundation", "intermediate", "advanced"].includes(bs0.tier), `tier 合法（${bs0.tier}）`);
  assert(!JSON.stringify(pubJ).includes("errorAnalysis"), "分享数据不含错因归因明细");

  const bad = await pub.fetch("/api/share/not-a-real-token-0123456789ab");
  assert(bad.status === 404, `坏 token 返回 404（实际 ${bad.status}）`);

  const rev = await t.fetch(`/api/teacher/share-links?id=${dbLink!.id}`, { method: "DELETE" });
  assert(rev.status === 200, `撤销链接 ${rev.status}`);
  const afterRev = await prisma.shareLink.findUnique({ where: { id: dbLink!.id } });
  assert(afterRev?.revoked === true, "DB 已撤销");
  const gone = await pub.fetch(`/api/share/${raw}`);
  assert(gone.status === 404, `撤销后公开访问 404（实际 ${gone.status}）`);

  const gRes = await s.fetch("/api/growth?subject=math");
  assert(gRes.status === 200, `学生 growth 接口回归 ${gRes.status}`);
  const gJ = (await gRes.json()) as { badges: unknown[]; stats: { submissions: number } };
  assert(Array.isArray(gJ.badges) && gJ.badges.length === 4 && typeof gJ.stats.submissions === "number", "growth 响应形状不变");

  console.log("\n== 16. 学习目标申诉闭环（提交 → 锁定 → 复核 → 学生可见） ==");
  const g1Res = await s.fetch("/api/goals", {
    method: "POST",
    body: JSON.stringify({ content: "E2E 申诉闭环目标（驳回路径）" }),
  });
  assert(g1Res.status === 201, `目标设定 ${g1Res.status}`);
  const goal1 = await g1Res.json();
  createdState!.goalIds.push(goal1.id);
  assert(goal1.appealStatus === "NONE" && goal1.challenged === false, "新目标申诉状态为 NONE");

  // 理由选填：不填也能提交申诉
  const ap1 = await s.fetch(`/api/goals/${goal1.id}`, {
    method: "PATCH",
    body: JSON.stringify({ action: "appeal" }),
  });
  const ap1J = await ap1.json();
  assert(ap1.status === 200 && ap1J.appealStatus === "PENDING", `不填理由也可申诉（${ap1.status}）`);
  assert(ap1J.challenged === true, "申诉后 challenged 派生为 true");

  // 通知：申诉 → 教师收到 appeal_filed 通知
  const notiFiled = (await (await t.fetch("/api/notifications")).json()) as {
    items: { type: string; link: string | null }[];
  };
  assert(
    notiFiled.items.some((x) => x.type === "appeal_filed" && x.link === "/teacher/review"),
    "教师收到目标申诉通知"
  );

  const lockRes = await s.fetch(`/api/goals/${goal1.id}`, {
    method: "PATCH",
    body: JSON.stringify({ done: true }),
  });
  assert(lockRes.status === 400, `复核中标记完成被服务端拒绝 400（实际 ${lockRes.status}）`);
  const locked = await prisma.learningGoal.findUniqueOrThrow({ where: { id: goal1.id } });
  assert(locked.done === false, "库中目标仍为未完成（已锁定）");

  const dupAp = await s.fetch(`/api/goals/${goal1.id}`, {
    method: "PATCH",
    body: JSON.stringify({ action: "appeal", reason: "重复提交" }),
  });
  assert(dupAp.status === 400, `重复申诉被拒 400（实际 ${dupAp.status}）`);

  const qList = await t.fetch(`/api/teacher/appeals?classId=${cls.id}`);
  const qListJ = (await qList.json()) as { items: { id: string; studentName: string }[] };
  assert(qListJ.items.some((x) => x.id === goal1.id), "教师申诉队列中出现该目标");
  const qCount = await (await t.fetch("/api/teacher/appeals?countOnly=1")).json();
  assert(Number(qCount.count) >= 1, `申诉计数 >= 1（实际 ${qCount.count}）`);
  const sDenied = await s.fetch("/api/teacher/appeals");
  assert(sDenied.status === 403, `学生访问教师申诉接口被拒 ${sDenied.status}`);

  // 路径一：驳回 → 目标恢复正常 → 学生可自行标记完成
  const rej = await t.fetch(`/api/teacher/appeals/${goal1.id}`, {
    method: "PATCH",
    body: JSON.stringify({ decision: "reject", reply: "E2E 驳回：请先完成本周练习" }),
  });
  const rejJ = await rej.json();
  assert(rej.status === 200 && rejJ.appealStatus === "REJECTED" && rejJ.done === false, "驳回后 REJECTED 且目标仍未完成");
  const rejAgain = await t.fetch(`/api/teacher/appeals/${goal1.id}`, {
    method: "PATCH",
    body: JSON.stringify({ decision: "accept" }),
  });
  assert(rejAgain.status === 400, `已处理的申诉不可重复处理 400（实际 ${rejAgain.status}）`);

  const stuGoals = (await (await s.fetch("/api/goals")).json()) as {
    id: string;
    appealReply: string | null;
  }[];
  assert(
    stuGoals.find((x) => x.id === goal1.id)?.appealReply === "E2E 驳回：请先完成本周练习",
    "学生端可见教师回复"
  );
  const doneRes = await s.fetch(`/api/goals/${goal1.id}`, {
    method: "PATCH",
    body: JSON.stringify({ done: true }),
  });
  assert(doneRes.status === 200 && (await doneRes.json()).done === true, "驳回后学生可自行标记完成");
  const afterDone = await s.fetch(`/api/goals/${goal1.id}`, {
    method: "PATCH",
    body: JSON.stringify({ action: "appeal", reason: "x" }),
  });
  assert(afterDone.status === 400, `已完成目标不能申诉 400（实际 ${afterDone.status}）`);

  // 路径二：申诉 → 采纳 → 目标自动视为达成
  const goal2 = await (
    await s.fetch("/api/goals", {
      method: "POST",
      body: JSON.stringify({ content: "E2E 申诉闭环目标（采纳路径）" }),
    })
  ).json();
  createdState!.goalIds.push(goal2.id);
  await s.fetch(`/api/goals/${goal2.id}`, {
    method: "PATCH",
    body: JSON.stringify({ action: "appeal", reason: "E2E：申请直接视为达成" }),
  });
  const acc = await t.fetch(`/api/teacher/appeals/${goal2.id}`, {
    method: "PATCH",
    body: JSON.stringify({ decision: "accept", reply: "E2E 同意，已视为达成" }),
  });
  const accJ = await acc.json();
  assert(acc.status === 200 && accJ.appealStatus === "ACCEPTED" && accJ.done === true, "采纳后 ACCEPTED 且目标已达成");

  // 通知：申诉处理 → 学生收到 appeal_resolved 通知
  const notiResolved = (await (await s.fetch("/api/notifications")).json()) as {
    items: { type: string; link: string | null }[];
  };
  assert(
    notiResolved.items.some((x) => x.type === "appeal_resolved" && x.link === "/student/goals"),
    "学生收到申诉处理通知"
  );
  assert(
    !((await (await t.fetch(`/api/teacher/appeals?classId=${cls.id}`)).json()).items as { id: string }[]).some(
      (x) => x.id === goal2.id
    ),
    "采纳后从待复核申诉队列移除"
  );

  console.log("\n== 20. 学号分配与同班重名 ==");
  const dupName = "E2E重名学生";
  const createdIds: string[] = [];
  try {
    const mk1 = await t.fetch("/api/teacher/students", {
      method: "POST",
      body: JSON.stringify({ name: dupName, classId: cls.id }),
    });
    const mk1J = await mk1.json();
    assert(mk1.status === 201, `创建重名学生 1 ${mk1.status}`);
    const mk2 = await t.fetch("/api/teacher/students", {
      method: "POST",
      body: JSON.stringify({ name: dupName, classId: cls.id }),
    });
    const mk2J = await mk2.json();
    assert(mk2.status === 201, `创建重名学生 2 ${mk2.status}`);
    createdIds.push(mk1J.id, mk2J.id);
    assert(
      typeof mk1J.studentNo === "string" && typeof mk2J.studentNo === "string",
      "创建响应含 studentNo"
    );
    assert(mk1J.studentNo !== mk2J.studentNo, `两个重名学生学号不同（${mk1J.studentNo} vs ${mk2J.studentNo}）`);

    const dashDup = (await (await t.fetch(`/api/teacher/dashboard?subject=math&classId=${cls.id}`)).json()) as {
      students: { id: string; name: string; studentNo: string | null }[];
      tiers: Record<string, { id: string; name: string; studentNo: string | null }[]>;
    };
    const tierEntries = Object.values(dashDup.tiers).flat().filter((x) => x.name === dupName);
    assert(tierEntries.length === 2, `看板分层名单含 2 个同名条目（实际 ${tierEntries.length}）`);
    assert(
      tierEntries.every((x) => createdIds.includes(x.id) && typeof x.studentNo === "string"),
      "分层条目按 id 区分且带学号"
    );
    for (const sid of createdIds) {
      const row = dashDup.students.find((x) => x.id === sid);
      assert(row && typeof row.studentNo === "string", `看板 students 含 ${sid} 的学号`);
    }

    // 学生列表接口：两名重名学生都带各自学号（登录下拉与全站显示由同一数据渲染）
    const stuList = (await (
      await t.fetch(`/api/teacher/students?classId=${cls.id}`)
    ).json()) as { students: { id: string; name: string; studentNo: string | null }[] };
    const dupRows = stuList.students.filter((x) => createdIds.includes(x.id));
    assert(
      dupRows.length === 2 &&
        dupRows.every((x) => typeof x.studentNo === "string") &&
        dupRows[0].studentNo !== dupRows[1].studentNo,
      `学生列表含两名重名学生且学号不同（${dupRows.map((x) => x.studentNo).join("、")}）`
    );
    // 登录页（SSR 数据载荷）包含两个重名条目；下拉项由该数据渲染（portal 不在 SSR HTML 中，无法直接断言选项文本）
    const loginHtml = await (await new Session().fetch("/login")).text();
    assert(
      loginHtml.split(dupName).length - 1 >= 2,
      `登录页数据含两个重名条目（${loginHtml.split(dupName).length - 1} 处）`
    );

    // 密码上限回归：33 位被拒、3 位被拒
    const pwLong = await t.fetch(`/api/teacher/students/${mk1J.id}`, {
      method: "PATCH",
      body: JSON.stringify({ password: "x".repeat(33) }),
    });
    assert(pwLong.status === 400, `33 位密码被拒 400（实际 ${pwLong.status}）`);
    const pwShort = await t.fetch(`/api/teacher/students/${mk1J.id}`, {
      method: "PATCH",
      body: JSON.stringify({ password: "abc" }),
    });
    assert(pwShort.status === 400, `3 位密码被拒 400（实际 ${pwShort.status}）`);
  } finally {
    // 清理：新学生无任何 FK 数据行，可硬删；失败残留也不污染下次运行
    if (createdIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: createdIds } } });
    }
  }

  console.log("\n== 21. 英语科目闭环（布置 → 提交 → 批改 → 掌握度 → 错题本 → 通知） ==");
  const engBankRes = await t.fetch("/api/questions?subject=english");
  assert(engBankRes.ok, `英语题库 ${engBankRes.status}`);
  const engBank: { id: string; answer: string; type: string }[] = await engBankRes.json();
  assert(engBank.length >= 10, `英语题库题目数 >= 10（实际 ${engBank.length}）`);
  const engPicked = engBank.slice(0, 3);
  const engA = await t.fetch("/api/assignments", {
    method: "POST",
    body: JSON.stringify({
      title: "E2E 英语闭环作业",
      type: "HOMEWORK",
      subjectId: english.id,
      classId: cls.id,
      questionIds: engPicked.map((q) => q.id),
    }),
  });
  assert(engA.status === 201, `布置英语作业 ${engA.status}`);
  const engAssignmentId = (await engA.json()).id as string;
  createdState!.assignmentIds.push(engAssignmentId);

  // 通知：布置作业 → 学生收到 assignment 通知
  const notiList = (await (await s.fetch("/api/notifications")).json()) as {
    items: { id: string; type: string; link: string | null }[];
  };
  const notiA = notiList.items.find(
    (x) => x.type === "assignment" && (x.link ?? "").endsWith(engAssignmentId)
  );
  assert(Boolean(notiA), "学生收到新作业通知");
  const countBefore = Number(
    ((await (await s.fetch("/api/notifications?countOnly=1")).json()) as { count: number }).count
  );
  assert(countBefore >= 1, `学生未读通知 >= 1（实际 ${countBefore}）`);
  await s.fetch("/api/notifications/read", {
    method: "POST",
    body: JSON.stringify({ ids: [notiA!.id] }),
  });
  const countAfter = Number(
    ((await (await s.fetch("/api/notifications?countOnly=1")).json()) as { count: number }).count
  );
  assert(countAfter === countBefore - 1, `标记已读后未读数 -1（${countBefore} → ${countAfter}）`);

  const engDetail = await (await s.fetch(`/api/assignments/${engAssignmentId}`)).json();
  const engSubmit = await s.fetch(`/api/assignments/${engAssignmentId}/submit`, {
    method: "POST",
    body: JSON.stringify({
      answers: engDetail.questions.map((q: { id: string }, i: number) => ({
        questionId: q.id,
        response: i === 0 ? engPicked[0].answer : "错误答案",
        timeSpentMs: 30000 + i * 5000,
      })),
    }),
  });
  assert(engSubmit.status === 201, `英语作业提交 ${engSubmit.status}`);
  const engResult = await engSubmit.json();
  assert(engResult.results.length === 3, "英语批改返回 3 条结果");
  assert(engResult.results[0].isCorrect === true, "英语第 1 题判为正确");
  assert(
    engResult.results.slice(1).every((r: { isCorrect: boolean | null }) => r.isCorrect === false),
    "英语其余题判为错误"
  );
  assert(Object.keys(engResult.mastery ?? {}).length > 0, "英语掌握度已更新");

  // 通知：提交 → 教师收到 submission 通知
  const tNoti = (await (await t.fetch("/api/notifications")).json()) as {
    items: { type: string; link: string | null }[];
  };
  assert(
    tNoti.items.some((x) => x.type === "submission" && (x.link ?? "").includes(engAssignmentId)),
    "教师收到英语作业提交通知"
  );

  const engWq = (await (await s.fetch("/api/wrong-questions?subject=english")).json()) as {
    questionId: string;
  }[];
  const engWrong = engPicked.slice(1).filter((q) => engWq.some((w) => w.questionId === q.id));
  assert(engWrong.length === 2, `英语错题进入错题本（${engWrong.length}/2）`);

  // 英语解答题 → 复核队列（种子 E8 有 2 道）
  const engOr = (await (
    await t.fetch("/api/questions?subject=english&type=OPEN_RESPONSE")
  ).json()) as { id: string }[];
  assert(engOr.length >= 2, `英语题库有解答题（${engOr.length} 道）`);
  const engOrA = await t.fetch("/api/assignments", {
    method: "POST",
    body: JSON.stringify({
      title: "E2E 英语复核队列作业",
      type: "HOMEWORK",
      subjectId: english.id,
      classId: cls.id,
      questionIds: [engOr[0].id],
    }),
  });
  assert(engOrA.status === 201, `布置英语解答题作业 ${engOrA.status}`);
  const engOrAssignmentId = (await engOrA.json()).id as string;
  createdState!.assignmentIds.push(engOrAssignmentId);
  const engOrSubmit = await s.fetch(`/api/assignments/${engOrAssignmentId}/submit`, {
    method: "POST",
    body: JSON.stringify({
      answers: [{ questionId: engOr[0].id, response: "I like apple.", timeSpentMs: 50000 }],
    }),
  });
  assert(engOrSubmit.status === 201, `英语解答题提交 ${engOrSubmit.status}`);
  const engOrResult = (await engOrSubmit.json()) as {
    results: { isCorrect: boolean | null; score: number | null; reviewStatus: string }[];
  };
  if (!llmConfigured()) {
    assert(
      engOrResult.results[0].isCorrect === null && engOrResult.results[0].reviewStatus === "needs_review",
      "无 Key 时英语解答题待复核"
    );
    const engQ = (await (await t.fetch(`/api/review-queue?classId=${cls.id}`)).json()) as {
      items: { assignmentTitle: string }[];
    };
    assert(
      engQ.items.some((x) => x.assignmentTitle === "E2E 英语复核队列作业"),
      "英语解答题进入复核队列"
    );
  } else {
    assert(
      typeof engOrResult.results[0].score === "number" &&
        ["none", "needs_review"].includes(engOrResult.results[0].reviewStatus),
      "有 Key 时英语解答题已 AI 批改"
    );
  }

  console.log("\n== 22. 语文 QUIZ 提交与错因标签分学科 ==");
  const chiBank = (await (await t.fetch("/api/questions?subject=chinese")).json()) as {
    id: string;
    answer: string;
    type: string;
  }[];
  assert(chiBank.length >= 10, `语文题库题目数 >= 10（实际 ${chiBank.length}）`);
  const chiChoice = chiBank.find((q) => q.type === "SINGLE_CHOICE");
  const chiFill = chiBank.find((q) => q.type === "FILL_BLANK") ?? chiBank[1];
  const chiOpen = chiBank.find((q) => q.type === "OPEN_RESPONSE");
  assert(Boolean(chiChoice && chiFill && chiOpen), "语文题库含三种题型");
  const chiIds = [chiChoice!, chiFill!, chiOpen!].map((q) => q.id);
  const chiA = await t.fetch("/api/assignments", {
    method: "POST",
    body: JSON.stringify({
      title: "E2E 语文小测",
      type: "QUIZ",
      subjectId: chinese.id,
      classId: cls.id,
      questionIds: chiIds,
    }),
  });
  assert(chiA.status === 201, `布置语文 QUIZ ${chiA.status}`);
  const chiAssignmentId = (await chiA.json()).id as string;
  createdState!.assignmentIds.push(chiAssignmentId);
  const chiList = (await (await s.fetch("/api/assignments?subject=chinese")).json()) as {
    id: string;
    type: string;
  }[];
  assert(chiList.find((a) => a.id === chiAssignmentId)?.type === "QUIZ", "语文作业列表显示 QUIZ 类型");
  const chiDetail = await (await s.fetch(`/api/assignments/${chiAssignmentId}`)).json();
  const chiSubmit = await s.fetch(`/api/assignments/${chiAssignmentId}/submit`, {
    method: "POST",
    body: JSON.stringify({
      answers: chiDetail.questions.map((q: { id: string; type: string }) => ({
        questionId: q.id,
        response: q.type === "SINGLE_CHOICE" ? chiChoice!.answer : q.type === "FILL_BLANK" ? "错误答案" : "不知道",
        timeSpentMs: 20000,
      })),
    }),
  });
  assert(chiSubmit.status === 201, `语文 QUIZ 提交 ${chiSubmit.status}`);
  const chiResult = await chiSubmit.json();
  const chiOpenResult = chiResult.results.find(
    (r: { questionId: string }) => r.questionId === chiOpen!.id
  ) as { errorTags: string[] };
  const CHI_VOCAB = ["理解偏差", "要点遗漏", "表达不当", "审题不清", "其他"];
  if (!llmConfigured()) {
    assert(
      Array.isArray(chiOpenResult.errorTags) && chiOpenResult.errorTags.length === 0,
      "无 Key 时解答题错因标签为空"
    );
  } else {
    assert(chiOpenResult.errorTags.length > 0, "有 Key 时解答题带错因标签");
    assert(
      chiOpenResult.errorTags.every((t) => CHI_VOCAB.includes(t)),
      `错因标签属于语文词汇表（${chiOpenResult.errorTags.join("、")}）`
    );
  }
  assert(Object.keys(chiResult.mastery ?? {}).length > 0, "语文掌握度已更新");
  const chiWq = (await (await s.fetch("/api/wrong-questions?subject=chinese")).json()) as {
    questionId: string;
  }[];
  assert(chiWq.some((w) => w.questionId === chiFill!.id), "语文错题进入错题本");

  console.log("\n== 23. AI 出题生成与布置 ==");
  const hwRes = await t.fetch("/api/ai/homework", {
    method: "POST",
    body: JSON.stringify({ subjectCode: "math", tier: "foundation", count: 2 }),
  });
  const hwJ = await hwRes.json();
  let aiAssignmentId: string | null = null;
  if (!llmConfigured()) {
    assert(hwRes.status === 502, `无 Key 时 AI 出题返回 502（实际 ${hwRes.status}）`);
    assert(String(hwJ.error ?? "").includes("未配置"), "错误信息提示未配置 Key");
  } else {
    assert(hwRes.status === 200, `AI 出题 ${hwRes.status}`);
    const hwQuestions: { stem: string; answer: string; type: string; options?: string[] | null }[] =
      hwJ.questions ?? [];
    assert(hwQuestions.length >= 1, `AI 出题返回 ${hwQuestions.length} 道`);
    assert(
      hwQuestions.every(
        (q) =>
          q.stem && q.answer && ["SINGLE_CHOICE", "FILL_BLANK", "OPEN_RESPONSE"].includes(q.type)
      ),
      "题目含 stem/answer 且类型合法"
    );
    const aiA = await t.fetch("/api/assignments", {
      method: "POST",
      body: JSON.stringify({
        title: "E2E AI 出题作业",
        type: "HOMEWORK",
        subjectId: math.id,
        classId: cls.id,
        questions: hwQuestions,
      }),
    });
    assert(aiA.status === 201, `AI 题目建作业 ${aiA.status}`);
    aiAssignmentId = (await aiA.json()).id as string;
    createdState!.assignmentIds.push(aiAssignmentId);
    const aiDetail = await (await s.fetch(`/api/assignments/${aiAssignmentId}`)).json();
    const aiSubmit = await s.fetch(`/api/assignments/${aiAssignmentId}/submit`, {
      method: "POST",
      body: JSON.stringify({
        answers: aiDetail.questions.map((q: { id: string }, i: number) => ({
          questionId: q.id,
          response: hwQuestions[i].answer,
          timeSpentMs: 40000,
        })),
      }),
    });
    assert(aiSubmit.status === 201, `AI 出题作业提交 ${aiSubmit.status}`);
  }

  console.log("\n== 24. 其余 AI 接口与掌握度接口冒烟 ==");
  // 备课助手
  const prepRes = await t.fetch("/api/ai/prep", {
    method: "POST",
    body: JSON.stringify({ subjectCode: "math", classId: cls.id, lessons: 1 }),
  });
  const prepJ = await prepRes.json();
  if (!llmConfigured()) {
    assert(prepRes.status === 502 && String(prepJ.error ?? "").includes("未配置"), `备课无 Key 502（实际 ${prepRes.status}）`);
  } else {
    assert(prepRes.status === 200 && Array.isArray(prepJ.prep?.flow) && prepJ.prep.flow.length >= 1, "备课返回教学流程");
  }
  // 苏格拉底辅导（学生端）
  const socRes = await s.fetch("/api/ai/socrates", {
    method: "POST",
    body: JSON.stringify({ messages: [{ role: "user", content: "什么是负数？" }] }),
  });
  const socJ = await socRes.json();
  if (!llmConfigured()) {
    assert(socRes.status === 502, `苏格拉底无 Key 502（实际 ${socRes.status}）`);
  } else {
    assert(socRes.status === 200 && typeof socJ.reply === "string" && socJ.reply.length > 0, "苏格拉底返回回复");
  }
  // 举一反三（要求是自己的错题：用组 2 的第 2 题，已入错题本）
  const simRes = await s.fetch("/api/ai/similar", {
    method: "POST",
    body: JSON.stringify({ questionId: picked[1].id }),
  });
  const simJ = await simRes.json();
  if (!llmConfigured()) {
    assert(simRes.status === 502, `举一反三无 Key 502（实际 ${simRes.status}）`);
  } else {
    assert(simRes.status === 200 && Array.isArray(simJ.questions) && simJ.questions.length === 3, "举一反三返回 3 道题");
  }
  // 单次作业个性化分析（组 8 的提交）
  const subAnalysis = await t.fetch("/api/ai/submission-analysis", {
    method: "POST",
    body: JSON.stringify({ submissionId: afterDetail.mySubmission.id }),
  });
  const subJ = await subAnalysis.json();
  if (!llmConfigured()) {
    assert(subAnalysis.status === 502, `个性化分析无 Key 502（实际 ${subAnalysis.status}）`);
  } else {
    assert(
      subAnalysis.status === 200 && typeof subJ.analysis?.summary === "string" && subJ.analysis.summary.length > 0,
      "个性化分析返回 summary"
    );
  }
  // 掌握度接口：学生可读自己的、教师按 studentId 读、学生不可读他人的
  const myMastery = await s.fetch("/api/mastery?subject=math");
  const myMasteryJ = await myMastery.json();
  assert(
    myMastery.status === 200 && Array.isArray(myMasteryJ) && myMasteryJ.every((m: { history?: unknown[] }) => Array.isArray(m.history)),
    "学生掌握度接口返回含历史数组"
  );
  const otherMastery = await s.fetch(`/api/mastery?subject=math&studentId=${teacher.id}`);
  assert(otherMastery.status === 403, `学生读他人掌握度被拒 ${otherMastery.status}`);
  const tMastery = await t.fetch(`/api/mastery?subject=math&studentId=${student.id}`);
  assert(tMastery.status === 200, `教师按 studentId 读掌握度 ${tMastery.status}`);

  console.log("\n== 25. 课堂讲评与 Excel 导出 ==");
  // 讲评数据（组 2 的 4 道选择题：1 对 3 错）
  const lecRes = await t.fetch(`/api/assignments/${assignmentId}/lecture`);
  assert(lecRes.status === 200, `讲评接口 ${lecRes.status}`);
  const lec = await lecRes.json();
  assert(lec.questions.length === 4, `讲评返回 4 题（实际 ${lec.questions.length}）`);
  const lecFirst = lec.questions[0] as {
    stats: {
      total: number;
      wrong: number;
      scoreRate: number | null;
      optionDist: { option: string; count: number }[] | null;
      wrongSamples: { studentNo: string | null }[];
    };
  };
  assert(lecFirst.stats.total === 1, "讲评统计作答数为 1");
  assert(lecFirst.stats.wrong === 1, "讲评排序首题错误数为 1（错误率降序）");
  assert(
    lecFirst.stats.wrongSamples.length === 1 && typeof lecFirst.stats.wrongSamples[0].studentNo === "string",
    "典型错误作答含学号"
  );
  // 选择题选项分布（题库前 4 题未必全为选择题，找一道选择题验证）
  const lecChoice = lec.questions.find((q: { type: string }) => q.type === "SINGLE_CHOICE") as
    | { stats: { optionDist: { option: string; count: number }[] | null } }
    | undefined;
  assert(Boolean(lecChoice), "讲评数据含选择题");
  const od = lecChoice!.stats.optionDist;
  assert(Array.isArray(od) && od.length === 4, "选择题选项分布含 4 个选项");
  assert(od!.reduce((a, o) => a + o.count, 0) === 1, "选项分布人数合计等于作答数");
  // 脱敏：典型错误作答只含学号、不含姓名字段
  assert(
    lec.questions.every(
      (q: { stats: { wrongSamples: Record<string, unknown>[] } }) =>
        q.stats.wrongSamples.every((w) => !("name" in w) && "studentNo" in w)
    ),
    "典型错误作答不含姓名字段（脱敏）"
  );
  // AI 讲评要点：恒 200（无 Key 模板兜底）
  const aiLecRes = await t.fetch("/api/ai/lecture", {
    method: "POST",
    body: JSON.stringify({ assignmentId }),
  });
  const aiLecJ = await aiLecRes.json();
  assert(aiLecRes.status === 200 && aiLecJ.items.length === 4, `AI 讲评要点返回 4 条（${aiLecJ.items?.length ?? 0}）`);
  assert(
    aiLecJ.items.every(
      (i: { angle?: string; pitfalls?: string[]; variant?: string }) =>
        i.angle && Array.isArray(i.pitfalls) && i.variant
    ),
    "每条讲评要点含 angle/pitfalls/variant"
  );
  if (!llmConfigured()) {
    assert(aiLecJ.aiGenerated === false, "无 Key 时 aiGenerated=false（模板兜底）");
  }
  const sLec = await s.fetch(`/api/assignments/${assignmentId}/lecture`);
  assert(sLec.status === 403, `学生访问讲评被拒 ${sLec.status}`);

  // Excel 导出（exceljs 回读校验 sheet 与表头）
  const checkXlsx = async (url: string, sheetName: string, headerCell: string) => {
    const r = await t.fetch(url);
    assert(r.status === 200, `导出 ${url} ${r.status}`);
    const ct = r.headers.get("content-type") ?? "";
    assert(ct.includes("spreadsheetml"), `导出 Content-Type 为 xlsx（${ct}）`);
    const cd = r.headers.get("content-disposition") ?? "";
    assert(cd.includes("attachment"), "导出带 Content-Disposition attachment");
    const buf = Buffer.from(await r.arrayBuffer());
    assert(buf.byteLength > 500, `导出文件非空（${buf.byteLength} 字节）`);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet(sheetName);
    assert(Boolean(ws), `导出包含 sheet「${sheetName}」`);
    assert(
      String(ws!.getRow(1).getCell(1).value ?? "").includes(headerCell),
      `表头含「${headerCell}」`
    );
  };
  await checkXlsx(`/api/export/dashboard?subject=math&classId=${cls.id}`, "掌握度矩阵", "学号");
  await checkXlsx(`/api/export/assignment/${assignmentId}`, "成绩单", "学号");
  await checkXlsx(`/api/export/weekly-report?subject=math&classId=${cls.id}`, "对比数据", "指标");
  const sExport = await s.fetch(`/api/export/dashboard?subject=math&classId=${cls.id}`);
  assert(sExport.status === 403, `学生访问导出被拒 ${sExport.status}`);

  // 自清理：删除本轮创建的作业/目标/分享链接，并按剩余提交恢复该生掌握度与错题本
  // （失败路径同样清理，见 main().catch；两处都容错——清理失败不影响断言结果，只提示残留风险）
  if (createdState) {
    try {
      await cleanupRun(prisma, createdState);
      console.log("\n🧹 已清理本轮 e2e 数据并恢复学生统计");
    } catch (e) {
      console.error("\n⚠️ 自清理失败（共享库可能残留本轮数据）:", e instanceof Error ? e.message : e);
    }
  }

  console.log(
    "\n✅ 全部端到端断言通过：闭环（布置 → 作答 → 批改 → 掌握度 → 错题 → 看板）+ F1 复核队列 + F2 补救聚合 + 学习目标申诉闭环 + 分层升降 + 周报 + 家长分享 + 学号与重名验证成功！"
  );
}

main()
  .catch(async (e) => {
    console.error("\n❌ 验证失败:", e.message);
    if (createdState) {
      try {
        await cleanupRun(prisma, createdState);
        console.error("🧹 已清理本轮已创建的部分 e2e 数据");
      } catch (ce) {
        console.error("⚠️ 失败路径清理未完成（共享库可能残留本轮数据）:", ce instanceof Error ? ce.message : ce);
      }
    }
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
