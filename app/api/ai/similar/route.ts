import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { parseArr } from "@/lib/json";
import { llmJson } from "@/lib/llm";
import { SIMILAR_SYSTEM } from "@/lib/prompts";
import { prisma } from "@/lib/prisma";

/** POST /api/ai/similar —— AI 举一反三（7.5）：{questionId}，生成 3 道同知识点递进练习 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireApiUser(["STUDENT"]);
    const body = await req.json();
    const question = await prisma.question.findUnique({
      where: { id: String(body?.questionId ?? "") },
    });
    if (!question) return ok({ error: "题目不存在" }, 404);
    // 仅允许对自己的错题调用
    const wq = await prisma.wrongQuestion.findUnique({
      where: {
        studentId_questionId: { studentId: session.user.id, questionId: question.id },
      },
    });
    if (!wq) return ok({ error: "只能对自己的错题生成举一反三练习" }, 403);

    const kpIds = parseArr(question.kpIds);
    const kps = await prisma.knowledgePoint.findMany({ where: { id: { in: kpIds } } });
    const kpNames = kps.map((k) => `${k.code} ${k.name}`).join("、");

    const result = await llmJson<{
      questions: { stem: string; answer: string; analysis: string }[];
    }>(
      [
        { role: "system", content: SIMILAR_SYSTEM },
        {
          role: "user",
          content: [
            `原题：${question.stem}`,
            `关联知识点：${kpNames}`,
            "请生成 3 道同知识点、同方法、难度递进的练习题。",
          ].join("\n"),
        },
      ],
      { maxTokens: 4096 }
    );

    const questions = (Array.isArray(result?.questions) ? result.questions : [])
      .filter((q) => q?.stem && q?.answer)
      .slice(0, 3);
    if (!questions.length) return ok({ error: "AI 未生成有效题目" }, 502);
    return ok({ questions });
  } catch (e) {
    return fail(e);
  }
}
