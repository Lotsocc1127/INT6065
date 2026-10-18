import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { llmConfigured, llmJson } from "@/lib/llm";
import { LECTURE_SYSTEM, lectureContext } from "@/lib/prompts";
import { buildLectureData, buildLectureFallback, type LectureItem } from "@/lib/lecture";

export const dynamic = "force-dynamic";

/** POST /api/ai/lecture —— 课堂讲评要点：{assignmentId, questionId?}
 * 无 Key / LLM 失败时模板兜底（基于真实统计），永远返回 200；aiGenerated 标识是否 AI 生成 */
export async function POST(req: NextRequest) {
  try {
    await requireApiUser(["TEACHER", "ADMIN"]);
    const body = await req.json().catch(() => ({}));
    const assignmentId = String(body?.assignmentId ?? "");
    if (!assignmentId) return ok({ error: "缺少 assignmentId" }, 400);

    const data = await buildLectureData(assignmentId);
    if (!data) return ok({ error: "作业不存在" }, 404);

    const targets = body?.questionId
      ? data.questions.filter((q) => q.id === String(body.questionId))
      : data.questions.slice(0, 12); // 全部生成上限 12 题，控制延迟
    if (!targets.length) return ok({ error: "题目不存在" }, 404);

    let items = buildLectureFallback(targets);
    let aiGenerated = false;

    if (llmConfigured()) {
      try {
        const g = await llmJson<{ items: LectureItem[] }>(
          [
            { role: "system", content: LECTURE_SYSTEM },
            {
              role: "user",
              content: lectureContext({
                subjectName: data.assignment.subjectName,
                title: data.assignment.title,
                questions: targets.map((q) => ({
                  questionId: q.id,
                  order: q.order,
                  type: q.type,
                  stem: q.stem,
                  options: q.options,
                  answer: q.answer,
                  analysis: q.analysis,
                  kpCodes: q.kpCodes,
                  stats: q.stats,
                })),
              }),
            },
          ],
          { task: "lecture", maxTokens: 4096 }
        );
        if (Array.isArray(g.items) && g.items.length) {
          const fallbackById = new Map(items.map((i) => [i.questionId, i]));
          items = targets.map((q) => {
            const ai = g.items.find((i) => i?.questionId === q.id);
            const fb = fallbackById.get(q.id)!;
            if (!ai) return fb;
            return {
              questionId: q.id,
              angle: typeof ai.angle === "string" && ai.angle.trim() ? ai.angle.trim() : fb.angle,
              pitfalls: Array.isArray(ai.pitfalls)
                ? ai.pitfalls.filter((p): p is string => typeof p === "string" && p.trim().length > 0).slice(0, 4)
                : [],
              variant: typeof ai.variant === "string" && ai.variant.trim() ? ai.variant.trim() : fb.variant,
            };
          });
          aiGenerated = true;
        }
      } catch (e) {
        console.warn("[ai/lecture] AI 生成失败，使用模板兜底:", e);
      }
    }

    return ok({ aiGenerated, items });
  } catch (e) {
    return fail(e);
  }
}
