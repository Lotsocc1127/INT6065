/**
 * 无头浏览器交互测试：模拟真实用户点击/输入，捕获交互触发的运行时错误。
 * 运行：npx tsx scripts/browser-interact.ts（需 dev server 在 localhost:3000）
 */
import { chromium, type Page } from "playwright-core";
import { PrismaClient } from "@prisma/client";

const BASE = "http://localhost:3000";
const prisma = new PrismaClient();

async function getSessionCookie(userId: string, password = "123456"): Promise<string> {
  const cookies = new Map<string, string>();
  const apply = (res: Response) => {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
  };
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  apply(csrfRes);
  const { csrfToken } = await csrfRes.json();
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      Cookie: [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ csrfToken, userId, password, json: "true" }).toString(),
    redirect: "manual",
  });
  apply(res);
  const token = cookies.get("next-auth.session-token");
  if (!token) throw new Error("未拿到 session cookie");
  return token;
}

function attachErrorCollector(page: Page, errors: string[]) {
  page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`[console.error] ${m.text().slice(0, 200)}`);
  });
}

let stepNo = 0;
async function step(name: string, errors: string[], fn: () => Promise<void>) {
  stepNo++;
  errors.length = 0;
  const prefix = `  ${String(stepNo).padStart(2, "0")}. ${name}`;
  try {
    await fn();
  } catch (e) {
    console.log(`❌ ${prefix}  — 步骤异常: ${(e as Error).message.split("\n")[0]}`);
    return;
  }
  if (errors.length) {
    console.log(`❌ ${prefix}  — 运行时错误:`);
    for (const e of errors.slice(0, 2)) console.log(`     ${e}`);
  } else {
    console.log(`✓ ${prefix}`);
  }
}

async function main() {
  const teacher = await prisma.user.findFirstOrThrow({ where: { role: "TEACHER" } });
  const student = await prisma.user.findFirstOrThrow({ where: { name: "王芳" } });
  const browser = await chromium.launch({ channel: "msedge", headless: true });

  // ---------- 登录页（真实 UI 流程） ----------
  {
    console.log("\n== 登录页 ==");
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors: string[] = [];
    attachErrorCollector(page, errors);
    await step("打开 /login", errors, async () => {
      await page.goto(BASE + "/login", { waitUntil: "networkidle" });
    });
    await step("打开身份选择下拉", errors, async () => {
      await page.getByRole("combobox").click();
      await page.waitForTimeout(300);
    });
    await step("选择教师 王老师", errors, async () => {
      await page.getByRole("option", { name: "王老师" }).click();
    });
    await step("点击登录", errors, async () => {
      await page.getByRole("button", { name: "登录" }).click();
      await page.waitForURL("**/teacher", { timeout: 15000 });
    });
    await ctx.close();
  }

  // ---------- 教师端 ----------
  const tToken = await getSessionCookie(teacher.id);
  const tCtx = await browser.newContext();
  await tCtx.addCookies([
    { name: "next-auth.session-token", value: tToken, domain: "localhost", path: "/" },
  ]);
  const tp = await tCtx.newPage();
  const tErr: string[] = [];
  attachErrorCollector(tp, tErr);

  console.log("\n== 教师端交互 ==");
  await step("看板：点击英语科目切换", tErr, async () => {
    await tp.goto(BASE + "/teacher", { waitUntil: "networkidle" });
    await tp.getByRole("tab", { name: "英语" }).click();
    await tp.waitForTimeout(1500);
  });
  await step("看板：切换班级下拉", tErr, async () => {
    await tp.getByRole("combobox").click();
    await tp.waitForTimeout(300);
    const opts = tp.getByRole("option");
    await opts.first().click();
    await tp.waitForTimeout(1500);
  });
  await step("看板：打开数据治理弹窗", tErr, async () => {
    await tp.getByRole("button", { name: "数据治理" }).click();
    await tp.waitForTimeout(500);
    await tp.keyboard.press("Escape");
    await tp.waitForTimeout(300);
  });
  await step("看板：点击学生进入详情", tErr, async () => {
    await tp.goto(BASE + "/teacher", { waitUntil: "networkidle" });
    await tp.waitForTimeout(1000);
    const badge = tp.locator("a[href^='/teacher/students/']").first();
    await badge.click();
    await tp.waitForURL("**/teacher/students/**", { timeout: 10000 });
    await tp.waitForTimeout(1500);
  });
  await step("学生详情：点击生成 AI 建议（预期 toast 提示未配 Key，不崩溃）", tErr, async () => {
    await tp.getByRole("button", { name: /生成建议|重新生成/ }).click();
    await tp.waitForTimeout(2500);
  });

  let newAssignmentUrl = "";
  await step("布置作业：选题 + 填写标题", tErr, async () => {
    await tp.goto(BASE + "/teacher/assignments/new", { waitUntil: "networkidle" });
    await tp.waitForTimeout(800);
    const rows = tp.locator("tbody tr");
    await rows.nth(0).click();
    await rows.nth(1).click();
    await tp.locator("#title").fill("交互测试作业");
  });
  await step("布置作业：打开 AI 分层出题对话框并生成（预期 toast 提示未配 Key）", tErr, async () => {
    await tp.getByRole("button", { name: "AI 分层出题" }).click();
    await tp.waitForTimeout(500);
    await tp.getByRole("button", { name: /开始生成|重新生成/ }).click();
    await tp.waitForTimeout(2500);
    await tp.keyboard.press("Escape");
  });
  await step("布置作业：确认布置并跳转详情", tErr, async () => {
    await tp.getByRole("button", { name: "确认布置" }).click();
    // 等待详情页（排除 /assignments/new 表单页自身）
    await tp.waitForURL(/\/teacher\/assignments\/(?!new)[^/]+$/, { timeout: 15000 });
    await tp.waitForSelector("text=题目与标准答案", { timeout: 15000 });
    newAssignmentUrl = tp.url();
    await tp.waitForTimeout(800);
  });

  // ---------- 学生端 ----------
  const sToken = await getSessionCookie(student.id);
  const sCtx = await browser.newContext();
  await sCtx.addCookies([
    { name: "next-auth.session-token", value: sToken, domain: "localhost", path: "/" },
  ]);
  const sp = await sCtx.newPage();
  const sErr: string[] = [];
  attachErrorCollector(sp, sErr);

  console.log("\n== 学生端交互 ==");
  await step("任务中心：切换英语科目", sErr, async () => {
    await sp.goto(BASE + "/student", { waitUntil: "networkidle" });
    await sp.getByRole("tab", { name: "英语" }).click();
    await sp.waitForTimeout(1200);
  });
  await step("知识图谱：查看雷达图", sErr, async () => {
    await sp.goto(BASE + "/student/map", { waitUntil: "networkidle" });
    await sp.waitForTimeout(1500);
  });
  await step("学习路径：查看拓扑路径", sErr, async () => {
    await sp.goto(BASE + "/student/path", { waitUntil: "networkidle" });
    await sp.waitForTimeout(1200);
  });
  await step("苏格拉底：发送一条消息（预期 toast 提示未配 Key，不崩溃）", sErr, async () => {
    await sp.goto(BASE + "/student/socrates", { waitUntil: "networkidle" });
    await sp.getByPlaceholder(/描述你的困惑/).fill("我想学解一元一次方程");
    await sp.getByRole("button", { name: "发送" }).click();
    await sp.waitForTimeout(2500);
  });
  await step("错题本：举一反三（预期 toast 提示未配 Key）", sErr, async () => {
    await sp.goto(BASE + "/student/wrong", { waitUntil: "networkidle" });
    await sp.getByRole("button", { name: "举一反三" }).first().click();
    await sp.waitForTimeout(2500);
    await sp.keyboard.press("Escape");
  });
  await step("错题本：标记掌握", sErr, async () => {
    await sp.getByRole("button", { name: "标记掌握" }).first().click();
    await sp.waitForTimeout(800);
  });
  await step("成长档案：查看徽章与曲线", sErr, async () => {
    await sp.goto(BASE + "/student/growth", { waitUntil: "networkidle" });
    await sp.waitForTimeout(1500);
  });
  await step("目标：添加目标", sErr, async () => {
    await sp.goto(BASE + "/student/goals", { waitUntil: "networkidle" });
    await sp.getByPlaceholder(/如：本周/).fill("交互测试：每天 5 道练习");
    await sp.getByRole("button", { name: "设定目标" }).click();
    await sp.waitForTimeout(1000);
  });
  await step("作答：打开新作业并作答提交", sErr, async () => {
    const url = newAssignmentUrl.replace("/teacher/", "/student/");
    console.log(`     URL: ${url}`);
    await sp.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    await sp.waitForTimeout(1000);
    console.log(
      `     按钮: ${await sp.locator("button").count()}, 填空: ${await sp.getByPlaceholder("填写答案").count()}, 单选: ${await sp.locator("input[type='radio']").count()}, 文本: ${await sp.getByPlaceholder(/写出解题步骤/).count()}`
    );
    // 填空题 / 选择题 / 解答题分别作答
    const blank = sp.getByPlaceholder("填写答案").first();
    if (await blank.isVisible().catch(() => false)) await blank.fill("is");
    const radio = sp.locator("input[type='radio']").first();
    if (await radio.isVisible().catch(() => false)) await radio.check();
    const open = sp.getByPlaceholder(/写出解题步骤/).first();
    if (await open.isVisible().catch(() => false)) await open.fill("我的解答过程");
    await sp.getByRole("button", { name: "提交作业" }).click();
    await sp.waitForSelector("text=批改结果", { timeout: 20000 });
    await sp.waitForTimeout(1200);
  });
  await step("批改结果页：查看掌握度更新卡片", sErr, async () => {
    await sp.waitForTimeout(800);
  });

  await tCtx.close();
  await sCtx.close();
  await browser.close();
  console.log("\n交互测试完成");
}

main()
  .catch((e) => {
    console.error("交互测试脚本失败:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
