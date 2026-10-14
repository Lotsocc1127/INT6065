import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { llmJson } from "@/lib/llm";
import { suggestPrompt } from "@/lib/prompts";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** POST /api/ai/suggest —— AI 培养建议（7.4）：{studentId, subjectCode} */
export async function POST(req: NextRequest) {
  try {
    await requireApiUser(["TEACHER", "ADMIN"]);
    const body = await req.json();
    const studentId = String(body?.studentId ?? "");
    const subjectCode = String(body?.subjectCode ?? "math");

    const [student, subject] = await Promise.all([
      prisma.user.findUnique({ where: { id: studentId } }),
      prisma.subject.findUnique({ where: { code: subjectCode } }),
    ]);
    if (!student || !subject) return ok({ error: "学生或科目不存在" }, 404);

    const masteries = await prisma.mastery.findMany({
      where: { studentId, subjectId: subject.id },
      include: { kp: true },
      orderBy: { kp: { code: "asc" } },
    });
    if (!masteries.length) return ok({ error: "该生暂无掌握度数据" }, 400);

    const suggestion = await llmJson<{
      summary: string;
      strengths: string[];
      gaps: string[];
      actions: { kpCode: string; action: string; reason: string }[];
    }>(
      [
        {
          role: "system",
          content: suggestPrompt(
            masteries.map((m) => ({ code: m.kp.code, name: m.kp.name, value: m.value }))
          ),
        },
      ],
      { maxTokens: 4096, task: "suggest" }
    );

    const kpByCode = new Map(masteries.map((m) => [m.kp.code, m.kp]));
    return ok({
      summary: suggestion?.summary ?? "",
      strengths: Array.isArray(suggestion?.strengths) ? suggestion.strengths : [],
      gaps: Array.isArray(suggestion?.gaps) ? suggestion.gaps : [],
      actions: (Array.isArray(suggestion?.actions) ? suggestion.actions : []).map((a) => ({
        kpId: kpByCode.get(a.kpCode)?.id ?? null,
        kpCode: a.kpCode,
        kpName: kpByCode.get(a.kpCode)?.name ?? a.kpCode,
        action: a.action,
        reason: a.reason,
      })),
    });
  } catch (e) {
    return fail(e);
  }
}
