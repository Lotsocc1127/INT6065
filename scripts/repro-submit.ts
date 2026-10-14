/**
 * 提交链路冒烟测试：直接调用 processSubmission 提交一份「临时作业」
 * （第 1 题故意答错以覆盖错题本分支），验证批量事务在 Neon Pooled 连接下可正常提交。
 * 每轮创建新临时作业 → 提交 → 清理（还原掌握度/错题本、删除临时数据）。
 * 运行：npx tsx scripts/repro-submit.ts [轮数]（需 .env 可用）
 */
import { prisma } from "../lib/prisma";
import { processSubmission } from "../lib/grading";

async function runOnce(round: number) {
  const testStart = new Date();
  const srcAq = await prisma.assignmentQuestion.findFirst({
    where: { question: { type: { in: ["SINGLE_CHOICE", "FILL_BLANK"] } } },
    orderBy: { assignmentId: "asc" },
    include: { assignment: true, question: true },
  });
  if (!srcAq) throw new Error("种子库没有客观题作业");
  const srcQuestions = await prisma.assignmentQuestion.findMany({
    where: { assignmentId: srcAq.assignmentId },
    orderBy: { order: "asc" },
    include: { question: true },
  });
  const objective = srcQuestions.filter(
    (q) => q.question.type === "SINGLE_CHOICE" || q.question.type === "FILL_BLANK"
  );
  const student = await prisma.user.findFirst({
    where: { role: "STUDENT", classId: srcAq.assignment.classId },
  });
  if (!student) throw new Error("该班没有学生");

  // 快照该生该科目掌握度 + 相关错题本，测试后还原
  const snap = await prisma.mastery.findMany({
    where: { studentId: student.id, subjectId: srcAq.assignment.subjectId },
  });
  const wqSnap = await prisma.wrongQuestion.findMany({
    where: { studentId: student.id, questionId: { in: objective.map((q) => q.questionId) } },
  });

  const tmp = await prisma.assignment.create({
    data: {
      title: `TMP-SUBMIT-TEST-${round}`,
      type: "HOMEWORK",
      subjectId: srcAq.assignment.subjectId,
      classId: srcAq.assignment.classId,
      questions: {
        create: objective.map((q, i) => ({
          questionId: q.questionId,
          order: i,
          tier: q.tier,
        })),
      },
    },
  });

  const answers = objective.map((q, i) => ({
    questionId: q.questionId,
    // 第 1 题故意答错（触发错题本分支），其余按标准答案作答
    response: i === 0 ? "___故意答错___" : q.question.answer,
    timeSpentMs: 5000,
  }));

  try {
    const t0 = Date.now();
    const result = await processSubmission({
      assignmentId: tmp.id,
      studentId: student.id,
      studentClassId: student.classId,
      answers,
    });
    console.log(
      `第 ${round} 轮 ✓ 提交成功（${Date.now() - t0}ms），批改 ${result.results.length} 题，掌握度更新 ${Object.keys(result.mastery).length} 个知识点`
    );
  } catch (e) {
    console.error(`第 ${round} 轮 ✗ 提交失败: ${(e as Error).message}`);
  } finally {
    // 清理：临时作业 + 相关提交/作答；还原掌握度
    await prisma.answerRecord.deleteMany({ where: { submission: { assignmentId: tmp.id } } });
    await prisma.submission.deleteMany({ where: { assignmentId: tmp.id } });
    await prisma.assignmentQuestion.deleteMany({ where: { assignmentId: tmp.id } });
    await prisma.assignment.delete({ where: { id: tmp.id } });
    for (const m of snap) {
      await prisma.mastery.update({ where: { id: m.id }, data: { value: m.value } });
    }
    await prisma.masteryPoint.deleteMany({
      where: {
        mastery: { studentId: student.id, subjectId: srcAq.assignment.subjectId },
        at: { gte: testStart },
      },
    });
    // 还原错题本：删除新增行，恢复原有行
    const wqNow = await prisma.wrongQuestion.findMany({
      where: { studentId: student.id, questionId: { in: objective.map((q) => q.questionId) } },
    });
    for (const w of wqNow) {
      const before = wqSnap.find((s) => s.id === w.id);
      if (before) {
        await prisma.wrongQuestion.update({
          where: { id: w.id },
          data: { wrongCount: before.wrongCount, mastered: before.mastered, lastWrongAt: before.lastWrongAt },
        });
      } else {
        await prisma.wrongQuestion.delete({ where: { id: w.id } });
      }
    }
    console.log(`第 ${round} 轮 已清理`);
  }
}

async function main() {
  const rounds = Number(process.argv[2] ?? 3);
  for (let i = 1; i <= rounds; i++) {
    await runOnce(i);
  }
  console.log("\n复现脚本完成");
}

main()
  .catch((e) => {
    console.error("复现脚本失败:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
