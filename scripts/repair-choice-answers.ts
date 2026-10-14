/**
 * 一次性修复脚本（选择题答案格式问题）：
 * 1. 把库中所有选择题 answer 归一化为选项字母（AI 生成的历史数据存的是选项文本）
 * 2. 重新批改「最新作业」的提交：重算选择题对错 → 反推并重算掌握度 → 修正错题本
 * 运行：npx tsx scripts/repair-choice-answers.ts
 */
import { prisma } from "../lib/prisma";
import { parseArr } from "../lib/json";
import { updateMastery } from "../lib/mastery";
import { gradeObjective } from "../lib/grading";
import { resolveChoiceLetter } from "../lib/utils";

type RateMap = Map<string, { sum: number; n: number }>;

async function main() {
  // ---- 1. 修复题目数据 ----
  const badChoices = await prisma.question.findMany({ where: { type: "SINGLE_CHOICE" } });
  let fixedQuestions = 0;
  for (const q of badChoices) {
    const options = parseArr(q.options);
    const letter = resolveChoiceLetter(options, q.answer);
    if (letter !== q.answer) {
      await prisma.question.update({ where: { id: q.id }, data: { answer: letter } });
      fixedQuestions += 1;
      console.log(`题目 ${q.id.slice(-6)}: answer ${JSON.stringify(q.answer)} → ${letter}`);
    }
  }
  console.log(`共修复 ${fixedQuestions} 道选择题答案`);

  // ---- 2. 重新批改最新作业的提交 ----
  const assignment = await prisma.assignment.findFirst({
    orderBy: { createdAt: "desc" },
    include: { class: true },
  });
  if (!assignment) return console.log("没有作业，跳过提交修复");
  const submissions = await prisma.submission.findMany({
    where: { assignmentId: assignment.id },
    orderBy: { submittedAt: "asc" },
    include: { student: true, answers: { include: { question: true } } },
  });
  if (!submissions.length) return console.log(`作业「${assignment.title}」还没有提交，跳过`);

  console.log(`\n作业「${assignment.title}」共 ${submissions.length} 份提交`);

  interface SubFix {
    sub: (typeof submissions)[number];
    badRates: RateMap;
    fixedRates: RateMap;
    changed: { wasCorrect: boolean | null; nowCorrect: boolean; questionId: string }[];
  }
  const fixes: SubFix[] = [];

  for (const sub of submissions) {
    const badRates: RateMap = new Map();
    const fixedRates: RateMap = new Map();
    const changed: SubFix["changed"] = [];
    const addRate = (m: RateMap, score: number | null, kpIds: string[]) => {
      if (score == null) return;
      for (const kpId of kpIds) {
        const e = m.get(kpId) ?? { sum: 0, n: 0 };
        e.sum += score;
        e.n += 1;
        m.set(kpId, e);
      }
    };

    for (const rec of sub.answers) {
      const kpIds = parseArr(rec.kpIds);
      addRate(badRates, rec.score, kpIds);
      // 客观题（选择/填空）均可确定性重判；解答题保持 AI 批改结果
      if (rec.question.type === "SINGLE_CHOICE" || rec.question.type === "FILL_BLANK") {
        const { isCorrect: nowCorrect } = gradeObjective(rec.question, rec.response);
        const score = nowCorrect ? 1 : 0;
        if (nowCorrect !== (rec.isCorrect ?? false) || score !== (rec.score ?? 0)) {
          await prisma.answerRecord.update({
            where: { id: rec.id },
            data: {
              isCorrect: nowCorrect,
              score,
              ...(nowCorrect ? { errorTags: "[]", errorAnalysis: null, improvement: null } : {}),
            },
          });
          changed.push({ wasCorrect: rec.isCorrect, nowCorrect, questionId: rec.questionId });
        }
        addRate(fixedRates, score, kpIds);
      } else {
        addRate(fixedRates, rec.score, kpIds);
      }
    }

    if (!changed.length) {
      console.log(`- ${sub.student.name}：客观题批改无变化，无需修复`);
      continue;
    }
    console.log(
      `- ${sub.student.name}：重批 ${changed.length} 题（${changed
        .map((c) => (c.wasCorrect === false && c.nowCorrect ? "错→对" : "对→错"))
        .join("、")}）`
    );

    // 该生若在本作业提交之后还有其他提交，掌握度反推会不精确 → 只修批改结果不动掌握度
    const laterSubs = await prisma.submission.count({
      where: { studentId: sub.studentId, submittedAt: { gt: sub.submittedAt } },
    });
    if (laterSubs > 0) {
      console.log(`  ⚠ ${sub.student.name} 之后还有 ${laterSubs} 份提交，跳过掌握度反推（批改结果已修正）`);
    } else {
      fixes.push({ sub, badRates, fixedRates, changed });
    }
  }

  // ---- 3. 掌握度：先按提交倒序反推提交前值，再按修正得分正序重算 ----
  for (const fix of fixes) {
    const kpIds = new Set([...fix.badRates.keys(), ...fix.fixedRates.keys()]);
    for (const kpId of kpIds) {
      const mastery = await prisma.mastery.findUnique({
        where: { studentId_kpId: { studentId: fix.sub.studentId, kpId } },
      });
      if (!mastery) continue;
      const bad = fix.badRates.get(kpId);
      const fixed = fix.fixedRates.get(kpId);
      const badRate = bad && bad.n ? bad.sum / bad.n : null;
      const fixedRate = fixed && fixed.n ? fixed.sum / fixed.n : null;
      let value = mastery.value;
      if (badRate != null) value = Math.min(1, Math.max(0, (value - 0.4 * badRate) / 0.6)); // 反推（next = prev*0.6 + rate*0.4）
      if (fixedRate != null) value = updateMastery(value, fixedRate); // 重算
      await prisma.mastery.update({ where: { id: mastery.id }, data: { value } });
      await prisma.masteryPoint.deleteMany({
        where: { masteryId: mastery.id, at: { gte: fix.sub.submittedAt } },
      });
      await prisma.masteryPoint.create({
        data: { masteryId: mastery.id, value, at: fix.sub.submittedAt },
      });
    }

    // ---- 4. 错题本：错→对 且无更早错题的删除记录，否则次数 -1 ----
    for (const c of fix.changed) {
      if (c.wasCorrect !== false || c.nowCorrect) continue;
      const wq = await prisma.wrongQuestion.findUnique({
        where: { studentId_questionId: { studentId: fix.sub.studentId, questionId: c.questionId } },
      });
      if (!wq) continue;
      const otherWrong = await prisma.answerRecord.count({
        where: {
          studentId: fix.sub.studentId,
          questionId: c.questionId,
          isCorrect: false,
          submissionId: { not: fix.sub.id },
        },
      });
      if (otherWrong === 0) {
        await prisma.wrongQuestion.delete({ where: { id: wq.id } });
        console.log(`  错题本：删除 ${fix.sub.student.name} 的错题记录（题目 ${c.questionId.slice(-6)}）`);
      } else {
        await prisma.wrongQuestion.update({
          where: { id: wq.id },
          data: { wrongCount: Math.max(1, wq.wrongCount - 1) },
        });
      }
    }
  }
  console.log("\n修复完成");
}

main()
  .catch((e) => {
    console.error("修复脚本失败:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
