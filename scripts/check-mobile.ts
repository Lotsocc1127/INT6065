/**
 * 临时验证脚本：375×812 手机视口逐页检查横向溢出（scrollWidth > clientWidth）。
 * 运行：npx tsx scripts/check-mobile.ts（需 dev server 在 localhost:3000）
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
  const assignment = await prisma.assignment.findFirstOrThrow();
  const browser = await chromium.launch({ channel: "msedge", headless: true });

  async function checkPages(label: string, userId: string, paths: string[]) {
    const token = await getSessionCookie(userId);
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    await ctx.addCookies([
      { name: "next-auth.session-token", value: token, domain: "localhost", path: "/" },
    ]);
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    for (const p of paths) {
      errors.length = 0;
      try {
        await page.goto(BASE + p, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(1500);
        const m = await page.evaluate(() => {
          const doc = document.scrollingElement!;
          return { sw: doc.scrollWidth, cw: doc.clientWidth };
        });
        const verdict = m.sw > m.cw + 1 ? `✗ 横向溢出 ${m.sw - m.cw}px` : "✓";
        console.log(`${verdict}  ${label} ${p}${errors.length ? ` (pageerror: ${errors[0].slice(0, 60)})` : ""}`);
      } catch (e) {
        console.log(`导航异常 ${label} ${p}: ${(e as Error).message.slice(0, 60)}`);
      }
    }
    await ctx.close();
  }

  await checkPages("教师端", teacher.id, [
    "/teacher",
    "/teacher/assignments",
    "/teacher/assignments/new",
    "/teacher/students",
    `/teacher/students/${student.id}`,
    "/teacher/prep",
  ]);
  await checkPages("学生端", student.id, [
    "/student",
    "/student/wrong",
    "/student/map",
    "/student/path",
    "/student/goals",
    "/student/socrates",
    `/student/assignments/${assignment.id}`,
  ]);
  await browser.close();
  console.log("\n手机视口检查完成");
}

main()
  .catch((e) => {
    console.error("检查失败:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
