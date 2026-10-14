import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { llmChat } from "@/lib/llm";
import { socratesSystem } from "@/lib/prompts";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** POST /api/ai/socrates —— 苏格拉底式辅导（7.6，绝不直接给答案）
 * {messages: [{role: "user"|"assistant", content}], questionId?} */
export async function POST(req: NextRequest) {
  try {
    await requireApiUser(["STUDENT", "TEACHER", "ADMIN"]);
    const body = await req.json();
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    if (!messages.length) return ok({ error: "消息为空" }, 400);

    let context: string | undefined;
    let subjectName: string | undefined;
    if (body?.questionId) {
      const q = await prisma.question.findUnique({
        where: { id: String(body.questionId) },
        include: { subject: true },
      });
      if (q) {
        subjectName = q.subject.name;
        const kpIds = ((): string[] => {
          try {
            const v = JSON.parse(q.kpIds);
            return Array.isArray(v) ? v : [];
          } catch {
            return [];
          }
        })();
        const kps = await prisma.knowledgePoint.findMany({ where: { id: { in: kpIds } } });
        context = `题目：${q.stem}${
          kps.length ? `\n关联知识点：${kps.map((k) => `${k.code} ${k.name}`).join("、")}` : ""
        }`;
      }
    } else if (body?.kpCode) {
      // 从知识点快捷入口进入：提供知识点背景（不含任何题目答案）
      const kp = await prisma.knowledgePoint.findFirst({
        where: { code: String(body.kpCode) },
        include: { subject: true },
      });
      if (kp) {
        subjectName = kp.subject.name;
        context = `学生当前想学习：${kp.subject.name} · ${kp.code} ${kp.name}${
          kp.description ? `\n知识点说明：${kp.description}` : ""
        }`;
      }
    }

    // 只保留最近 12 轮对话
    const history = messages
      .slice(-12)
      .map((m: { role?: string; content?: string }) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.content ?? ""),
      }));

    const reply = await llmChat(
      [{ role: "system", content: socratesSystem(context, subjectName) }, ...history],
      {
        maxTokens: 1024,
        temperature: 0.6,
        task: "socrates",
      }
    );
    return ok({ reply });
  } catch (e) {
    return fail(e);
  }
}
