import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { llmJson } from "@/lib/llm";
import { parseArr } from "@/lib/json";
import { SUBMISSION_ANALYSIS_SYSTEM } from "@/lib/prompts";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  SINGLE_CHOICE: "选择题",
  FILL_BLANK: "填空题",
  OPEN_RESPONSE: "解答题",
};

/** POST /api/ai/submission-analysis —— 单次作业个性化分析（7.8）：{submissionId} */
export async function POST(req: NextRequest) {
  try {
    await requireApiUser(["TEACHER", "ADMIN"]);
    const body = await req.json();
    const submissionId = String(body?.submissionId ?? "");
    if (!submissionId) return ok({ error: "缺少 submissionId" }, 400);

    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: { student: true, answers: true },
    });
    if (!submission) return ok({ error: "作答不存在" }, 404);

    const questions = await prisma.question.findMany({
      where: { id: { in: submission.answers.map((a) => a.questionId) } },
      include: { subject: true },
    });
    const qById = new Map(questions.map((q) => [q.id, q]));
    const kpIds = [...new Set(questions.flatMap((q) => parseArr(q.kpIds)))];
    const kps = await prisma.knowledgePoint.findMany({ where: { id: { in: kpIds } } });
    const kpById = new Map(kps.map((k) => [k.id, k]));

    // 逐题上下文：题号/题型/知识点/作答/判定/得分/用时/错因
    const answerLines = submission.answers
      .map((a, i) => {
        const q = qById.get(a.questionId);
        if (!q) return null;
        const kpNames = parseArr(q.kpIds)
          .map((id) => {
            const k = kpById.get(id);
            return k ? `${k.code} ${k.name}` : null;
          })
          .filter(Boolean)
          .join("、");
        const score = a.score == null ? "未批改" : `${Math.round(a.score * 100)}%`;
        const correct = a.isCorrect == null ? "未批改" : a.isCorrect ? "正确" : "错误";
        const tags = parseArr<string>(a.errorTags).join("、") || "无";
        const time = a.timeSpentMs ? `${Math.round(a.timeSpentMs / 1000)} 秒` : "—";
        return `第 ${i + 1} 题（${TYPE_LABEL[q.type] ?? q.type}，知识点：${kpNames || "—"}）：作答「${a.response || "（空）"}」；判定 ${correct}，得分 ${score}；用时 ${time}；错因标签：${tags}`;
      })
      .filter(Boolean)
      .join("\n");

    const result = await llmJson<{
      summary: string;
      strengths: string[];
      issues: string[];
      suggestions: string[];
    }>(
      [
        { role: "system", content: SUBMISSION_ANALYSIS_SYSTEM },
        {
          role: "user",
          content: `学生：${submission.student.name}\n科目：${questions[0]?.subject.name ?? "—"}\n本次作业逐题数据：\n${answerLines}\n\n请基于以上数据给出个性化分析与发展建议。`,
        },
      ],
      { maxTokens: 4096, task: "analysis" }
    );

    const str = (v: unknown, fb = "") => (typeof v === "string" ? v : fb);
    const strArr = (v: unknown) =>
      Array.isArray(v) ? v.map((x) => String(x)).slice(0, 8) : [];
    const analysis = {
      summary: str(result?.summary),
      strengths: strArr(result?.strengths),
      issues: strArr(result?.issues),
      suggestions: strArr(result?.suggestions),
    };
    if (!analysis.summary) return ok({ error: "AI 未生成有效分析" }, 502);

    return ok({ analysis });
  } catch (e) {
    return fail(e);
  }
}
