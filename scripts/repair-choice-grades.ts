/**
 * 修复「选择题把正确选项判错」的存量数据（P0-2）。
 *
 * 背景：
 * - 旧 seed 生成错误作答时，可能抽到「正确选项的文本」（如作答 "3"、正解 "B"），
 *   而旧 gradeObjective 只归一化标准答案、不归一化学生作答，于是被判错。
 * - 修复代码后（lib/grading.ts + prisma/seed.ts），存量数据仍是错的，需要一次性修正。
 *
 * 安全约定（重要）：
 * - 本脚本默认 **dry-run**，只统计和打印样例，不写库。
 * - `--apply` 才会更新 AnswerRecord 的 isCorrect/score；**不会重算掌握度**。
 * - 加 `--recompute` 时，对每条修正记录调用 lib/review.ts 的 applyReview，
 *   重算相关知识点掌握度并重放后续提交；会慢很多（61 条约 10 分钟，Neon 跨区）。
 * - 开发库与线上是同一个 Neon 库：确认后再加 --apply。
 *
 * 用法：
 *   npx tsx --env-file=.env scripts/repair-choice-grades.ts
 *   npx tsx --env-file=.env scripts/repair-choice-grades.ts --apply
 *   npx tsx --env-file=.env scripts/repair-choice-grades.ts --apply --recompute
 */
import { PrismaClient } from "@prisma/client";
import { parseArr } from "../lib/json";
import { resolveChoiceLetter } from "../lib/utils";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const RECOMPUTE = process.argv.includes("--recompute");

interface Row {
  id: string;
  response: string;
  isCorrect: boolean | null;
  score: number | null;
  question: {
    id: string;
    stem: string;
    options: string | null;
    answer: string;
    subject: { name: string };
  };
  submission: {
    student: { name: string; studentNo: string | null };
    assignment: { id: string; title: string; source: string | null };
  };
}

function normLetter(options: string[], value: string): string {
  return resolveChoiceLetter(options, value).trim().toUpperCase();
}

async function main() {
  const rows = (await prisma.answerRecord.findMany({
    where: { question: { type: "SINGLE_CHOICE" } },
    select: {
      id: true,
      response: true,
      isCorrect: true,
      score: true,
      question: {
        select: {
          id: true,
          stem: true,
          options: true,
          answer: true,
          subject: { select: { name: true } },
        },
      },
      submission: {
        select: {
          student: { select: { name: true, studentNo: true } },
          assignment: { select: { id: true, title: true, source: true } },
        },
      },
    },
  })) as Row[];

  const bad = rows.filter((r) => {
    const options = parseArr<string>(r.question.options);
    const expected = normLetter(options, r.question.answer);
    const got = normLetter(options, r.response);
    if (!expected || !got || expected !== got) return false;
    // 作答本身等于正确选项，但记录被判错/未给满分
    return r.isCorrect !== true || (r.score ?? 0) < 1;
  });

  const bySubject = new Map<string, number>();
  const byAssignment = new Map<string, number>();
  for (const r of bad) {
    const s = r.question.subject.name;
    bySubject.set(s, (bySubject.get(s) ?? 0) + 1);
    const a = r.submission.assignment.title;
    byAssignment.set(a, (byAssignment.get(a) ?? 0) + 1);
  }

  console.log(`选择题作答共 ${rows.length} 条；其中「作答=正确选项文本/字母，却被判错」${bad.length} 条。`);
  console.log("按科目：", Object.fromEntries(bySubject));
  console.log("按作业：", Object.fromEntries(byAssignment));
  console.log("\n样例（最多 12 条）：");
  for (const r of bad.slice(0, 12)) {
    const options = parseArr<string>(r.question.options);
    console.log(
      [
        `- ${r.submission.student.name}${r.submission.student.studentNo ? `（${r.submission.student.studentNo}）` : ""}`,
        r.submission.assignment.title,
        `作答「${r.response}」→ ${normLetter(options, r.response)}`,
        `正解「${r.question.answer}」→ ${normLetter(options, r.question.answer)}`,
        `isCorrect=${String(r.isCorrect)} score=${String(r.score)}`,
      ].join(" | ")
    );
  }

  if (!APPLY) {
    console.log(
      "\n当前是 dry-run，未写库。确认后执行：\n" +
        "  npx tsx --env-file=.env scripts/repair-choice-grades.ts --apply\n" +
        "需要同时重算掌握度时再加 --recompute（较慢）。"
    );
    return;
  }

  if (!bad.length) {
    console.log("没有需要修复的记录。");
    return;
  }

  // 只更新记录（客观题：满分、无错因）。分批 10 条，避免 Pooled 连接并发过高。
  for (let i = 0; i < bad.length; i += 10) {
    const chunk = bad.slice(i, i + 10);
    await prisma.$transaction(
      chunk.map((r) =>
        prisma.answerRecord.update({
          where: { id: r.id },
          data: {
            isCorrect: true,
            score: 1,
            errorTags: "[]",
            errorAnalysis: null,
            confidence: 1,
          },
        })
      )
    );
    console.log(`已更新 ${Math.min(i + 10, bad.length)} / ${bad.length}`);
  }

  if (!RECOMPUTE) {
    console.log(
      "\n记录已修正，但掌握度未重算。需要重算时执行（会逐条调用 applyReview，较慢）：\n" +
        "  npx tsx --env-file=.env scripts/repair-choice-grades.ts --apply --recompute\n" +
        "注意：--recompute 会对 source!=demo 的作业重放后续提交，修正相关学生/知识点的掌握度。"
    );
    return;
  }

  const { applyReview } = await import("../lib/review");
  let done = 0;
  for (const r of bad) {
    await applyReview({
      recordId: r.id,
      isCorrect: true,
      score: 1,
      errorAnalysis: null,
      errorTags: [],
      confidence: 1,
      reviewer: "teacher",
    });
    done++;
    if (done % 5 === 0 || done === bad.length) console.log(`掌握度重算 ${done} / ${bad.length}`);
  }
  console.log("完成：记录 + 掌握度均已修正。");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
