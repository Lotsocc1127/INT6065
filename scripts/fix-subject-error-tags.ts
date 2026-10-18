/**
 * 一次性修复：非数学科目作答记录上遗留的数学错因标签 → 本学科标签。
 *
 * 背景：第三批「错因分学科」之前，seed 与 AI 批改共用固定数学标签池
 * （计算失误/概念混淆/步骤遗漏/审题错误），语文等科目的存量 AnswerRecord
 * 仍带着这些标签（如语文题显示「计算失误」）。本脚本按学科重映射，幂等：
 * 重跑无数学标签残留时为零改动。
 *
 * 重映射（数学标签 → 学科标签，语义就近；无对应者归「其他」）：
 *   chinese: 计算失误/计算错误/步骤遗漏 → 要点遗漏；概念混淆 → 理解偏差；审题错误 → 审题不清
 *   english: 概念混淆/审题错误 → 理解偏差；其余 → 其他
 *
 * 用法：npx tsx --env-file=.env scripts/fix-subject-error-tags.ts [--apply]
 * （默认仅预览；生产库共享，改动前先看预览）
 */
import { prisma } from "../lib/prisma";
import { parseArr, toArrStr } from "../lib/json";

const MATH_TAGS = new Set(["计算失误", "计算错误", "概念混淆", "步骤遗漏", "审题错误"]);

const CHINESE_MAP: Record<string, string> = {
  "计算失误": "要点遗漏",
  "计算错误": "要点遗漏",
  步骤遗漏: "要点遗漏",
  概念混淆: "理解偏差",
  审题错误: "审题不清",
};
const ENGLISH_MAP: Record<string, string> = {
  概念混淆: "理解偏差",
  审题错误: "理解偏差",
};

const apply = process.argv.includes("--apply");

async function main() {
  const subjects = await prisma.subject.findMany();
  const codeById = new Map(subjects.map((s) => [s.id, s.code]));

  const records = await prisma.answerRecord.findMany({
    select: {
      id: true,
      errorTags: true,
      question: { select: { subjectId: true, stem: true } },
    },
  });

  const changes: { id: string; oldTags: string[]; newTags: string[]; subject: string; stem: string }[] = [];
  const bySubject = new Map<string, number>();
  for (const r of records) {
    const code = codeById.get(r.question?.subjectId ?? "");
    const tags = parseArr(r.errorTags);
    if (!code || !tags.length || (code !== "chinese" && code !== "english")) continue;
    const map = code === "chinese" ? CHINESE_MAP : ENGLISH_MAP;
    // 只重映射数学标签；本学科既有标签（如「理解偏差」）原样保留
    const newTags = [...new Set(tags.map((t) => (MATH_TAGS.has(t) ? map[t] ?? "其他" : t)))];
    const changed = newTags.length !== tags.length || newTags.some((t, i) => t !== tags[i]);
    if (!changed) continue;
    bySubject.set(code, (bySubject.get(code) ?? 0) + 1);
    changes.push({ id: r.id, oldTags: tags, newTags, subject: code, stem: r.question?.stem ?? "" });
  }

  console.log(`总记录 ${records.length} 条；待修复 ${changes.length} 条（chinese ${bySubject.get("chinese") ?? 0}，english ${bySubject.get("english") ?? 0}）`);
  for (const c of changes.slice(0, 8)) {
    console.log(`  [${c.subject}] ${JSON.stringify(c.oldTags)} → ${JSON.stringify(c.newTags)} :: ${c.stem.slice(0, 32)}`);
  }

  if (!apply) {
    console.log("\n预览模式：加 --apply 执行写入");
    await prisma.$disconnect();
    return;
  }

  // Pooled 连接并发敏感：分批批量事务（20 条/批）
  const BATCH = 20;
  let done = 0;
  for (let i = 0; i < changes.length; i += BATCH) {
    const batch = changes.slice(i, i + BATCH);
    await prisma.$transaction(
      batch.map((c) =>
        prisma.answerRecord.update({
          where: { id: c.id },
          data: { errorTags: toArrStr(c.newTags) },
        })
      )
    );
    done += batch.length;
    console.log(`  已修复 ${done}/${changes.length}`);
  }
  await prisma.$disconnect();
  console.log("完成");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
