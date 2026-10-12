import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { llmJson } from "@/lib/llm";
import { homeworkPrompt } from "@/lib/prompts";
import { prisma } from "@/lib/prisma";
import type { Tier } from "@/lib/mastery";

export const dynamic = "force-dynamic";

/** POST /api/ai/homework —— AI 分层作业生成（7.2）：{subjectCode, kpCodes?, tier, count} */
export async function POST(req: NextRequest) {
  try {
    await requireApiUser(["TEACHER", "ADMIN"]);
    const body = await req.json();
    const subjectCode = String(body?.subjectCode ?? "math");
    const tier = (["foundation", "intermediate", "advanced"].includes(body?.tier)
      ? body.tier
      : "intermediate") as Tier;
    const count = Math.min(10, Math.max(1, Number(body?.count) || 5));
    const kpCodes: string[] = Array.isArray(body?.kpCodes) ? body.kpCodes : [];

    const subject = await prisma.subject.findUnique({ where: { code: subjectCode } });
    if (!subject) return ok({ error: "科目不存在" }, 404);
    const kps = await prisma.knowledgePoint.findMany({
      where: {
        subjectId: subject.id,
        ...(kpCodes.length ? { code: { in: kpCodes } } : {}),
      },
      orderBy: { code: "asc" },
    });
    if (!kps.length) return ok({ error: "没有可选知识点" }, 400);

    const result = await llmJson<{
      questions: {
        stem: string;
        type: string;
        options: string[] | null;
        answer: string;
        analysis: string;
        kpCode: string;
        difficulty: number;
      }[];
    }>(
      [
        {
          role: "system",
          content: homeworkPrompt({
            subjectName: subject.name,
            kps: kps.map((k) => ({ code: k.code, name: k.name })),
            tier,
            count,
          }),
        },
      ],
      { maxTokens: 8192 }
    );

    const kpByCode = new Map(kps.map((k) => [k.code, k]));
    const questions = (Array.isArray(result?.questions) ? result.questions : [])
      .filter((q) => q?.stem && q?.answer)
      .slice(0, count)
      .map((q) => ({
        stem: q.stem,
        type: ["SINGLE_CHOICE", "FILL_BLANK", "OPEN_RESPONSE"].includes(q.type)
          ? q.type
          : "FILL_BLANK",
        options: Array.isArray(q.options) && q.type === "SINGLE_CHOICE" ? q.options.slice(0, 4) : null,
        answer: q.answer,
        analysis: q.analysis ?? "",
        kpId: kpByCode.get(q.kpCode)?.id ?? kps[0].id,
        difficulty: Math.min(5, Math.max(1, Math.round(Number(q.difficulty) || 2))),
      }));
    if (!questions.length) return ok({ error: "AI 未生成有效题目" }, 502);

    return ok({ questions });
  } catch (e) {
    return fail(e);
  }
}
