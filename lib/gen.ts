/**
 * AI 出题公共管线（从 app/api/ai/homework 抽取）：
 * 生成 → 消毒（LaTeX/答案字母化/难度归一）→ 独立验算修正 → GeneratedQuestion[]
 * 供补救作业生成等场景复用；错题上下文（典型错例/高频错因）作为附加 user 消息。
 */
import { llmJson } from "./llm";
import { homeworkPrompt, VERIFY_SYSTEM } from "./prompts";
import { stripLatex } from "./latex";
import { resolveChoiceLetter } from "./utils";
import type { Tier } from "./mastery";

export interface GeneratedQuestion {
  stem: string;
  type: string;
  options: string[] | null;
  answer: string;
  analysis: string;
  kpId: string;
  difficulty: number;
}

export async function generateTypedQuestions(opts: {
  subjectName: string;
  kps: { code: string; name: string; id: string }[];
  tier: Tier;
  count: number;
  /** 附加上下文（错题示例/高频错因），拼进 user 消息 */
  context?: string;
}): Promise<GeneratedQuestion[]> {
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
          subjectName: opts.subjectName,
          kps: opts.kps.map((k) => ({ code: k.code, name: k.name })),
          tier: opts.tier,
          count: opts.count,
        }),
      },
      ...(opts.context ? [{ role: "user" as const, content: opts.context }] : []),
    ],
    { maxTokens: 8192 }
  );

  const kpByCode = new Map(opts.kps.map((k) => [k.code, k]));
  const questions = (Array.isArray(result?.questions) ? result.questions : [])
    .filter((q) => q?.stem && q?.answer)
    // 选择题必须带选项，否则无法作答，直接丢弃
    .filter((q) => q.type !== "SINGLE_CHOICE" || (Array.isArray(q.options) && q.options.length >= 2))
    .slice(0, opts.count)
    .map((q) => {
      const options =
        Array.isArray(q.options) && q.type === "SINGLE_CHOICE"
          ? q.options.slice(0, 4).map(stripLatex)
          : null;
      return {
        stem: stripLatex(q.stem),
        type: ["SINGLE_CHOICE", "FILL_BLANK", "OPEN_RESPONSE"].includes(q.type)
          ? q.type
          : "FILL_BLANK",
        options,
        // 选择题答案归一化为选项字母（AI 可能返回选项文本）
        answer:
          q.type === "SINGLE_CHOICE" && options
            ? resolveChoiceLetter(options, stripLatex(q.answer))
            : stripLatex(q.answer),
        analysis: stripLatex(q.analysis ?? ""),
        kpId: kpByCode.get(q.kpCode)?.id ?? opts.kps[0].id,
        difficulty: Math.min(5, Math.max(1, Math.round(Number(q.difficulty) || 2))),
      };
    });
  if (!questions.length) throw new Error("AI 未生成有效题目");

  // 独立验算：生成模型的答案可能与解析矛盾。第二次调用逐题重算，只修正确有错误的题；
  // 验算失败时保留原答案（教师审校兜底）。
  try {
    const verify = await llmJson<{ fixes: { index: number; answer: string; analysis: string }[] }>(
      [
        { role: "system", content: VERIFY_SYSTEM },
        {
          role: "user",
          content: JSON.stringify(
            questions.map((q, i) => ({
              index: i,
              stem: q.stem,
              type: q.type,
              options: q.options,
              answer: q.answer,
              analysis: q.analysis,
            }))
          ),
        },
      ],
      { maxTokens: 4096 }
    );
    const fixed: number[] = [];
    for (const f of Array.isArray(verify?.fixes) ? verify.fixes : []) {
      const q = questions[f?.index];
      if (!q) continue;
      const answer =
        q.type === "SINGLE_CHOICE" && q.options
          ? resolveChoiceLetter(q.options, stripLatex(String(f.answer ?? "")))
          : stripLatex(String(f.answer ?? ""));
      if (answer && answer !== q.answer) {
        q.answer = answer;
        if (f.analysis) q.analysis = stripLatex(String(f.analysis));
        fixed.push(f.index + 1);
      }
    }
    if (fixed.length) console.log(`[lib/gen] 独立验算修正 ${fixed.length} 题（第 ${fixed.join("、")} 题）`);
  } catch (e) {
    console.warn("[lib/gen] 独立验算失败，保留原答案:", e);
  }

  return questions;
}
