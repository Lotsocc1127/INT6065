/**
 * 无头浏览器复现脚本：用系统 Edge 打开各页面，捕获 pageerror / console error。
 * 运行：npx tsx scripts/browser-check.ts（需 dev server 在 localhost:3000）
 */
import { chromium } from "playwright-core";
import { PrismaClient } from "@prisma/client";

const BASE = "http://localhost:3000";
const prisma = new PrismaClient();

async function getSessionCookie(userId: string, password = "123456"): Promise<string> {
  let cookies = new Map<string, string>();
  const apply = (res: Response) => {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
  };
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`, { headers: { Cookie: "" } });
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

async function main() {
  const teacher = await prisma.user.findFirstOrThrow({ where: { role: "TEACHER" } });
  const student = await prisma.user.findFirstOrThrow({ where: { role: "STUDENT" } });

  const browser = await chromium.launch({
    channel: "msedge",
    headless: true,
  });

  async function checkPages(label: string, userId: string, paths: string[]) {
    const token = await getSessionCookie(userId);
    const ctx = await browser.newContext({
      colorScheme: "dark", // 顺带验证深色模式图表
    });
    await ctx.addCookies([
      { name: "next-auth.session-token", value: token, domain: "localhost", path: "/" },
    ]);
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}\n${e.stack ?? ""}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`[console.error] ${m.text()}`);
    });
    for (const p of paths) {
      errors.length = 0;
      console.log(`\n== ${label} 打开 ${p} ==`);
      try {
        await page.goto(BASE + p, { waitUntil: "networkidle", timeout: 30000 });
        await page.waitForTimeout(1200);
      } catch (e) {
        console.log(`  导航异常: ${(e as Error).message.split("\n")[0]}`);
      }
      if (errors.length) {
        console.log("  ❌ 发现错误:");
        for (const e of errors.slice(0, 3)) console.log("   " + e.split("\n").slice(0, 4).join("\n     "));
      } else {
        console.log("  ✓ 无错误");
      }
      // 截当前页面标题作为存活信号
      const title = await page.title().catch(() => "");
      console.log(`  标题: ${title}`);
    }
    await ctx.close();
  }

  // 教师端页面（含科目切换后的看板）
  const teacherPaths = [
    "/teacher",
    "/teacher?subject=english",
    "/teacher/assignments",
    "/teacher/assignments/new",
  ];
  // 作业详情与学生详情需要真实 id
  const assignment = await prisma.assignment.findFirstOrThrow();
  teacherPaths.push(`/teacher/assignments/${assignment.id}`);
  teacherPaths.push(`/teacher/students/${student.id}`);
  await checkPages("教师端", teacher.id, teacherPaths);

  // 学生端页面
  const submission = await prisma.submission.findFirstOrThrow({
    where: { studentId: student.id },
    orderBy: { submittedAt: "desc" },
  });
  const studentPaths = [
    "/student",
    "/student/map",
    "/student/path",
    "/student/socrates",
    "/student/wrong",
    "/student/growth",
    "/student/goals",
    `/student/assignments/${assignment.id}`, // 未提交作业（作答视图）
    `/student/assignments/${submission.assignmentId}`, // 已提交作业（批改视图）
  ];
  await checkPages("学生端", student.id, studentPaths);

  await browser.close();
  console.log("\n浏览器复现完成");
}

main()
  .catch((e) => {
    console.error("复现脚本失败:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
