import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { gradeAnswer } from "@/lib/grading";
import { prisma } from "@/lib/prisma";

/** POST /api/ai/grade —— 单题批改（教师手动批改入口）：{questionId, response} */
export async function POST(req: NextRequest) {
  try {
    await requireApiUser(["TEACHER", "ADMIN"]);
    const body = await req.json();
    const question = await prisma.question.findUnique({ where: { id: String(body?.questionId ?? "") } });
    if (!question) return ok({ error: "题目不存在" }, 404);
    const result = await gradeAnswer(question, String(body?.response ?? ""));
    return ok(result);
  } catch (e) {
    return fail(e);
  }
}
