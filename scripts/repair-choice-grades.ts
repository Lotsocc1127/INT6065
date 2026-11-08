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
 * - `--apply --recompute` 逐条调用 lib/review.ts 的 applyReview：
 *   同时更新记录、重算相关知识点掌握度、清理/递减对应错题本条目（这是完整修复）。
 * - 写库前会先把受影响的 AnswerRecord / WrongQuestion / Mastery / MasteryPoint
 *   备份到 /tmp/zhixue-repair-backup-*.json。
 * - 开发库与线上是同一个 Neon 库：确认后再执行 `--apply`。
 * - 禁止 `seed --force`（会覆盖线上数据）。
 *
 * 用法：
 *   npx tsx --env-file=.env scripts/repair-choice-grades.ts
 *   npx tsx --env-file=.env scripts/repair-choice-grades.ts --apply --recompute
 */
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import { parseArr } from "../lib/json";
import { resolveChoiceLetter } from "../lib/utils";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const RECOMPUTE = process.argv.includes("--recompute");

interface Row {
  id: string;
  submissionId: string;
  response: string;
  isCorrect: boolean | null;
  score: number | null;
  kpIds: string;
  errorTags: string;
  errorAnalysis: string | null;
  confidence: number | null;
  reviewStatus: string;
  reviewedAt: Date | null;
  question: {
    id: string;
    stem: string;
    options: string | null;
    answer: string;
    subject: { name: string };
  };
  submission: {
    id: string;
    studentId: string;
    submittedAt: Date;
    student: { name: string; studentNo: string | null };
    assignment: { id: string; title: string; source: string | null };
  };
}

function normLetter(options: string[], value: string): string {
  return resolveChoiceLetter(options, value).trim().toUpperCase();
}

/** 把受影响的记录/错题本/掌握度/历史点落盘，便于回滚核对 */
async function writeBackup(bad: Row[]): Promise<string> {
  const studentIds = [...new Set(bad.map((r) => r.submission.studentId))];
  const wrongKeys = bad.map((r) => ({
    studentId: r.submission.studentId,
    questionId: r.question.id,
  }));
  const [wrongQuestions, masteries] = await Promise.all([
    prisma.wrongQuestion.findMany({ where: { OR: wrongKeys } }),
    prisma.mastery.findMany({ where: { studentId: { in: studentIds } } }),
  ]);
  const points = masteries.length
    ? await prisma.masteryPoint.findMany({
        where: { masteryId: { in: masteries.map((m) => m.id) } },
        orderBy: { at: "asc" },
      })
    : [];
  const backup = {
    createdAt: new Date().toISOString(),
    note: "repair-choice-grades: affected students' Mastery/MasteryPoint + WrongQuestion + AnswerRecord",
    badRecords: bad,
    wrongQuestions,
    masteries,
    points,
  };
  const file = `/tmp/zhixue-repair-backup-${Date.now()}.json`;
  fs.writeFileSync(file, JSON.stringify(backup, null, 2));
  return file;
}

async function main() {
  const rows = (await prisma.answerRecord.findMany({
    where: { question: { type: "SINGLE_CHOICE" } },
    select: {
      id: true,
      submissionId: true,
      response: true,
      isCorrect: true,
      score: true,
      kpIds: true,
      errorTags: true,
      errorAnalysis: true,
      confidence: true,
      reviewStatus: true,
      reviewedAt: true,
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
          id: true,
          studentId: true,
          submittedAt: true,
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
        "  npx tsx --env-file=.env scripts/repair-choice-grades.ts --apply --recompute\n" +
        "（--recompute 会同时重算掌握度并清理错题本；只加 --apply 则仅改记录。）"
    );
    return;
  }

  if (!bad.length) {
    console.log("没有需要修复的记录。");
    return;
  }

  const backupFile = await writeBackup(bad);
  console.log(`\n已备份到：${backupFile}`);

  if (RECOMPUTE) {
    // 完整修复：applyReview 会更新记录 + 重算掌握度 + 删/减错题本。
    // 注意不能先批量改记录——那会让 applyReview 走「无变化」短路，掌握度和错题本不会重算。
    const { applyReview } = await import("../lib/review");
    let done = 0;
    const failures: { id: string; error: string }[] = [];
    for (const r of bad) {
      try {
        await applyReview({
          recordId: r.id,
          isCorrect: true,
          score: 1,
          errorAnalysis: null,
          errorTags: [],
          confidence: 1,
          reviewer: "teacher",
        });
      } catch (e) {
        failures.push({ id: r.id, error: e instanceof Error ? e.message : String(e) });
      }
      done++;
      if (done % 5 === 0 || done === bad.length) {
        console.log(`修复进度 ${done} / ${bad.length}${failures.length ? `（失败 ${failures.length}）` : ""}`);
      }
    }
    if (failures.length) {
      console.log("\n以下记录失败，可重跑脚本（已修好的会被过滤掉）：");
      for (const f of failures) console.log(`- ${f.id}: ${f.error.slice(0, 160)}`);
      process.exitCode = 1;
    } else {
      console.log("\n完成：记录 + 掌握度 + 错题本均已修正。");
    }
    return;
  }

  // 仅改记录（客观题：满分、无错因）。分批 10 条，避免 Pooled 连接并发过高。
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

  console.log(
    "\n记录已修正，但掌握度未重算。需要完整修复时执行：\n" +
      "  npx tsx --env-file=.env scripts/repair-choice-grades.ts --apply --recompute\n" +
      "（已修好的记录会被过滤掉，不会重复改。）"
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
