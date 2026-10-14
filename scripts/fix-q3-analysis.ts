/**
 * 一次性修复脚本：Q3 解答题的错因文本是旧答案（-11/3）批改时生成的，
 * 标准答案已修正为 -2，这里用修正后的题目重新生成 errorAnalysis/improvement。
 * 判分结论（错、0 分）保持不变；LLM 失败时清空旧文本。
 * 运行：npx tsx scripts/fix-q3-analysis.ts
 */
import { prisma } from "../lib/prisma";
import { parseArr, toArrStr } from "../lib/json";
import { llmConfigured, llmJson } from "../lib/llm";
import { GRADE_SYSTEM } from "../lib/prompts";

async function main() {
  const rec = await prisma.answerRecord.findFirst({
    where: { question: { id: { endsWith: "lkhzfd" } } },
    include: { question: true, student: true },
  });
  if (!rec) throw new Error("找不到 Q3 作答记录");
  console.log(`记录: ${rec.student.name} | 作答=${JSON.stringify(rec.response)} | 判分=${rec.isCorrect} 分=${rec.score}`);
  console.log("旧 errorAnalysis:", JSON.stringify(rec.errorAnalysis));

  if (!llmConfigured()) {
    await prisma.answerRecord.update({ where: { id: rec.id }, data: { errorAnalysis: null } });
    console.log("未配置 LLM，已清空旧文本");
    return;
  }
  const q = rec.question;
  try {
    const g = await llmJson<{
      isCorrect: boolean;
      score: number;
      errorTags: string[];
      errorAnalysis: string;
      improvement: string;
    }>([
      { role: "system", content: GRADE_SYSTEM },
      {
        role: "user",
        content: [
          `题目：${q.stem}`,
          q.options ? `选项：${JSON.stringify(parseArr(q.options))}` : "",
          `标准答案：${q.answer}`,
          q.analysis ? `解析：${q.analysis}` : "",
          `学生作答：${rec.response}`,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ]);
    await prisma.answerRecord.update({
      where: { id: rec.id },
      data: {
        errorTags: toArrStr(Array.isArray(g.errorTags) ? g.errorTags : []),
        errorAnalysis: g.errorAnalysis ?? null,
        improvement: g.improvement ?? null,
      },
    });
    console.log("新 errorAnalysis:", JSON.stringify(g.errorAnalysis));
    console.log("新 improvement:", JSON.stringify(g.improvement));
  } catch (e) {
    await prisma.answerRecord.update({ where: { id: rec.id }, data: { errorAnalysis: null } });
    console.warn("LLM 生成失败，已清空旧文本:", e);
  }
}

main()
  .catch((e) => {
    console.error("修复失败:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
