/**
 * 临时验证脚本：F4 演示数据 生成 → 幂等重跑 → 清除回退 全流程（写库，结束后清理）
 * 运行：npx tsx --env-file=.env scripts/test-demo.ts
 */
import { prisma } from "../lib/prisma";
import { clearDemoData, generateDemoCycle } from "../lib/demo";

async function main() {
  // 快照：清除前受影响 Mastery 行（取一个学生）
  const student = await prisma.user.findFirst({ where: { role: "STUDENT" } });
  const before = await prisma.mastery.findMany({
    where: { studentId: student!.id },
    select: { id: true, value: true },
  });
  const beforeMap = new Map(before.map((m) => [m.id, m.value]));

  // 1. 生成
  const s1 = await generateDemoCycle();
  console.log("生成 summary:", JSON.stringify(s1));

  const demoAssignments = await prisma.assignment.count({ where: { source: "demo" } });
  const demoPoints = await prisma.masteryPoint.count({ where: { source: "demo" } });
  const pending = await prisma.answerRecord.count({
    where: { reviewStatus: "needs_review", submission: { assignment: { source: "demo" } } },
  });
  const wrongMastered = await prisma.wrongQuestion.count({ where: { mastered: true } });
  console.log(`核对: 演示作业=${demoAssignments}（应 ${s1.assignments}） 演示历史点=${demoPoints} 待复核=${pending}（应 ${s1.pendingReview}）`);
  console.log(`错题本 mastered=true 条数（全库）: ${wrongMastered}（演示约 30%）`);

  // 2. 幂等重跑
  const s2 = await generateDemoCycle();
  const same = JSON.stringify(s1) === JSON.stringify(s2);
  const demoAssignments2 = await prisma.assignment.count({ where: { source: "demo" } });
  console.log(`幂等重跑: summary 一致=${same} 演示作业数=${demoAssignments2}（应 ${s1.assignments}，无翻倍）`);

  // 3. 清除回退
  await clearDemoData();
  const afterAssignments = await prisma.assignment.count({ where: { source: "demo" } });
  const afterPoints = await prisma.masteryPoint.count({ where: { source: "demo" } });
  const after = await prisma.mastery.findMany({
    where: { id: { in: [...beforeMap.keys()] } },
    select: { id: true, value: true },
  });
  const restored = after.every((m) => Math.abs(m.value - (beforeMap.get(m.id) ?? 0.3)) < 1e-9);
  console.log(`清除: 演示作业=${afterAssignments}（应 0） 演示历史点=${afterPoints}（应 0） 掌握度回退=${restored ? "全部一致 ✓" : "存在偏差 ✗"}`);
  const orphanDemoQuestions = await prisma.question.count({ where: { stem: { startsWith: "【演示】" } } });
  console.log(`孤儿演示题=${orphanDemoQuestions}（应 0）`);

  console.log("\nF4 验证完成");
}

main()
  .catch((e) => {
    console.error("验证失败:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
