import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { clearDemoData, generateDemoCycle } from "@/lib/demo";

export const dynamic = "force-dynamic";
// 演示生成有批量写入，放宽到 5 分钟（Vercel fluid compute 上限内）
export const maxDuration = 300;

/** 模块级锁：防连点（同一 warm 实例内生效） */
let generating = false;

/** POST /api/demo —— 一键演示数据（教师端/管理端）：{mode:"generate"|"clear"} */
export async function POST(req: NextRequest) {
  try {
    await requireApiUser(["TEACHER", "ADMIN"]);
    const body = await req.json();
    const mode = String(body?.mode ?? "generate") === "clear" ? "clear" : "generate";
    if (mode === "clear") {
      await clearDemoData();
      return ok({ mode: "clear", cleared: true });
    }
    if (generating) return ok({ error: "正在生成中，请稍候再试" }, 409);
    generating = true;
    try {
      const summary = await generateDemoCycle();
      return ok({ mode: "generate", ...summary });
    } finally {
      generating = false;
    }
  } catch (e) {
    return fail(e);
  }
}
