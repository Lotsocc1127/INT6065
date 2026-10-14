import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { llmJson } from "@/lib/llm";
import { homeworkPrompt, VERIFY_SYSTEM } from "@/lib/prompts";
import { prisma } from "@/lib/prisma";
import { resolveChoiceLetter } from "@/lib/utils";
import type { Tier } from "@/lib/mastery";

export const dynamic = "force-dynamic";

/** 移除 AI 输出中常见的 LaTeX 标记，数学符号转普通文本（防止页面乱码） */
function stripLatex(s: string): string {
  return s
    .replace(/\$\$?/g, "") // $...$ 定界符
    .replace(/\\[\(\[]|\\[\)\]]/g, "") // \( \) \[ \]
    .replace(/\\(frac|dfrac)\{([^{}]*)\}\{([^{}]*)\}/g, "($2)/($3)")
    .replace(/\\sqrt\{([^{}]*)\}/g, "√($1)")
    .replace(/\\times/g, "×")
    .replace(/\\div/g, "÷")
    .replace(/\\cdot/g, "·")
    .replace(/\\pm/g, "±")
    .replace(/\\leq/g, "≤")
    .replace(/\\geq/g, "≥")
    .replace(/\\neq|\\ne/g, "≠")
    .replace(/\\angle/g, "∠")
    .replace(/\\circ/g, "°")
    .replace(/\\prime/g, "′")
    .replace(/\\(overline|overleftrightarrow|mathrm|mathbf|textit|text)\{([^{}]*)\}/g, "$2");
}

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
      { maxTokens: 8192, task: "homework" }
    );

    const kpByCode = new Map(kps.map((k) => [k.code, k]));
    const questions = (Array.isArray(result?.questions) ? result.questions : [])
      .filter((q) => q?.stem && q?.answer)
      // 选择题必须带选项，否则无法作答，直接丢弃（全部无效时返回 502）
      .filter((q) => q.type !== "SINGLE_CHOICE" || (Array.isArray(q.options) && q.options.length >= 2))
      .slice(0, count)
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
          kpId: kpByCode.get(q.kpCode)?.id ?? kps[0].id,
          difficulty: Math.min(5, Math.max(1, Math.round(Number(q.difficulty) || 2))),
        };
      });
    if (!questions.length) return ok({ error: "AI 未生成有效题目" }, 502);

    // 独立验算：生成模型的答案可能与解析矛盾（如 -9+2+1 算成 -10）。
    // 第二次调用逐题重算，只修正确有错误的题；验算失败时保留原答案（教师审校兜底）。
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
        { maxTokens: 4096, task: "verify" }
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
      if (fixed.length) console.log(`[ai/homework] 独立验算修正 ${fixed.length} 题（第 ${fixed.join("、")} 题）`);
    } catch (e) {
      console.warn("[ai/homework] 独立验算失败，保留原答案:", e);
    }

    return ok({ questions });
  } catch (e) {
    return fail(e);
  }
}
