/**
 * 端到端闭环验证脚本（开发用，非产品代码）：
 * 教师登录 → 布置作业 → 学生登录 → 在线作答 → 自动批改 → 掌握度更新 → 错题归集 → 教师看板刷新
 * 运行：npx tsx scripts/e2e-test.ts（需 dev server 已在 http://localhost:3000 运行）
 */
import { PrismaClient } from "@prisma/client";
import { llmConfigured } from "../lib/llm";

const BASE = "http://localhost:3000";
const prisma = new PrismaClient();

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
  const cls = await prisma.class.findUniqueOrThrow({ where: { id: student.classId! } });
  const kps = await prisma.knowledgePoint.findMany({ where: { subjectId: math.id } });

  console.log(`\n== 1. 教师 ${teacher.name} 登录 ==`);
  const t = new Session();
  await t.login(teacher.id);

  console.log("\n== 2. 教师布置作业 ==\n（题库选题）");
  const qRes = await t.fetch(`/api/questions?subject=math`);
  assert(qRes.ok, `题库接口 ${qRes.status}`);
  const bank: { id: string; kpIds: string[]; stem: string; answer: string }[] = await qRes.json();
  assert(bank.length >= 10, `题库题目数 >= 10（实际 ${bank.length}）`);
  const picked = bank.slice(0, 4);
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
  } else {
    console.log("  （已配置 LLM Key，跳过无 Key 分支断言；解答题走 AI 批改路径）");
  }

  console.log("\n== 14. F4 应用内一键演示数据 ==");
  const admin = await findLoginable("ADMIN");
  const ad = new Session();
  await ad.login(admin.id);
  const qBefore = await (await t.fetch(`/api/review-queue?countOnly=1`)).json();
  const countBefore = Number(qBefore.count) || 0;

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

  const gen = await ad.fetch("/api/admin/demo", { method: "POST", body: JSON.stringify({ mode: "generate" }) });
  assert(gen.status === 200, `生成演示数据 ${gen.status}`);
  const genJ = (await gen.json()) as {
    mode: string;
    classes: number;
    assignments: number;
    submissions: number;
    answers: number;
    pendingReview: number;
  };
  assert(genJ.mode === "generate", "generate 响应 mode 正确");
  assert(genJ.classes === demoClasses.length, `覆盖 ${demoClasses.length} 个班级（实际 ${genJ.classes}）`);
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
    needsReview === countBefore + genJ.pendingReview,
    `DB 中待复核 = 生成前 ${countBefore} + 演示 ${genJ.pendingReview}（实际 ${needsReview}）`
  );
  const qGen = await (await t.fetch(`/api/review-queue?countOnly=1`)).json();
  assert(Number(qGen.count) === countBefore + genJ.pendingReview, `复核队列含演示待复核项（${qGen.count}）`);

  // 幂等：重复生成不翻倍
  const gen2 = await ad.fetch("/api/admin/demo", { method: "POST", body: JSON.stringify({ mode: "generate" }) });
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
  const clear = await ad.fetch("/api/admin/demo", { method: "POST", body: JSON.stringify({ mode: "clear" }) });
  assert(clear.status === 200, `清除演示数据 ${clear.status}`);
  const clearJ = await clear.json();
  assert(clearJ.mode === "clear" && clearJ.cleared === true, "clear 响应正确");
  assert((await prisma.assignment.count({ where: { source: "demo" } })) === 0, "DB 中 demo 作业已清零");
  assert((await prisma.masteryPoint.count({ where: { source: "demo" } })) === 0, "demo 掌握度历史点已清零");
  const qAfter = await (await t.fetch(`/api/review-queue?countOnly=1`)).json();
  assert(Number(qAfter.count) === countBefore, `复核队列恢复（${qAfter.count}）`);
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

  console.log("\n== 16. 学习目标申诉闭环（提交 → 锁定 → 复核 → 学生可见） ==");
  const g1Res = await s.fetch("/api/goals", {
    method: "POST",
    body: JSON.stringify({ content: "E2E 申诉闭环目标（驳回路径）" }),
  });
  assert(g1Res.status === 201, `目标设定 ${g1Res.status}`);
  const goal1 = await g1Res.json();
  assert(goal1.appealStatus === "NONE" && goal1.challenged === false, "新目标申诉状态为 NONE");

  // 理由选填：不填也能提交申诉
  const ap1 = await s.fetch(`/api/goals/${goal1.id}`, {
    method: "PATCH",
    body: JSON.stringify({ action: "appeal" }),
  });
  const ap1J = await ap1.json();
  assert(ap1.status === 200 && ap1J.appealStatus === "PENDING", `不填理由也可申诉（${ap1.status}）`);
  assert(ap1J.challenged === true, "申诉后 challenged 派生为 true");

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
  assert(
    !((await (await t.fetch(`/api/teacher/appeals?classId=${cls.id}`)).json()).items as { id: string }[]).some(
      (x) => x.id === goal2.id
    ),
    "采纳后从待复核申诉队列移除"
  );

  console.log(
    "\n✅ 全部端到端断言通过：闭环（布置 → 作答 → 批改 → 掌握度 → 错题 → 看板）+ F1 复核队列 + F2 补救聚合 + 学习目标申诉闭环验证成功！"
  );
}

main()
  .catch((e) => {
    console.error("\n❌ 验证失败:", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
