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
    if (j.error) throw new Error(`登录失败: ${j.error}`);
    return j;
  }
}

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function main() {
  const teacher = await prisma.user.findFirstOrThrow({ where: { role: "TEACHER" } });
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

  console.log("\n✅ 全部端到端断言通过：闭环（布置 → 作答 → 批改 → 掌握度 → 错题 → 看板）+ F1 复核队列 + F2 补救聚合验证成功！");
}

main()
  .catch((e) => {
    console.error("\n❌ 验证失败:", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
