/**
 * 一次性清理共享库里全部 e2e 测试残留（2026-10-14/15 多轮 e2e 留下的 15 条目标、18 条作业、
 * 6 条分享链接，及被拉偏的学生掌握度/错题本）。
 * 用法：npx tsx --env-file=.env scripts/cleanup-e2e-data.ts         # 预览（只读）
 *       npx tsx --env-file=.env scripts/cleanup-e2e-data.ts --apply # 执行
 */
import { PrismaClient } from "@prisma/client";
import { cleanupAllE2e, computeRebuildPlan, type DeletedSub } from "./e2e-cleanup";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  const asgs = await prisma.assignment.findMany({
    where: { title: { startsWith: "E2E" } },
    select: { id: true, title: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const goals = await prisma.learningGoal.findMany({
    where: { content: { startsWith: "E2E" } },
    select: { id: true, content: true, createdAt: true, studentId: true },
    orderBy: { createdAt: "asc" },
  });
  const deletedSubs: DeletedSub[] = await prisma.submission.findMany({
    where: { assignmentId: { in: asgs.map((a) => a.id) } },
    select: { submittedAt: true, answers: { select: { kpIds: true, score: true } } },
  });
  const boundary = deletedSubs.length
    ? new Date(Math.min(...deletedSubs.map((s) => s.submittedAt.getTime())))
    : null;
  const subStudents = boundary
    ? await prisma.submission.findMany({
        where: { assignmentId: { in: asgs.map((a) => a.id) } },
        distinct: ["studentId"],
        select: { studentId: true },
      })
    : [];
  const studentIds = [...new Set([...goals.map((g) => g.studentId), ...subStudents.map((s) => s.studentId)])];
  const links = await prisma.shareLink.findMany({
    where: boundary
      ? { studentId: { in: studentIds }, createdAt: { gte: boundary } }
      : { studentId: { in: studentIds } },
    select: { id: true, createdAt: true, revoked: true },
    orderBy: { createdAt: "asc" },
  });

  console.log(`${APPLY ? "▶ 执行清理" : "▶ 预览（只读，未写库）"}；边界时间 = ${boundary?.toISOString() ?? "无提交"}\n`);
  console.log(`将删除 e2e 目标 ${goals.length} 条：`);
  for (const g of goals) console.log(`  - ${g.content}`);
  console.log(`\n将删除 e2e 作业 ${asgs.length} 条（含作答/提交/选题）：`);
  for (const a of asgs) console.log(`  - ${a.title} @ ${a.createdAt.toISOString()}`);
  console.log(`\n将删除受影响学生的分享链接 ${links.length} 条：`);
  for (const l of links) console.log(`  - ${l.createdAt.toISOString()} revoked=${l.revoked}`);

  if (boundary) {
    for (const sid of studentIds) {
      const stu = await prisma.user.findUnique({ where: { id: sid }, select: { name: true, studentNo: true } });
      console.log(`\n恢复 ${stu?.name}(${stu?.studentNo ?? "-"}) 的掌握度与错题本：`);
      const plan = await computeRebuildPlan(prisma, sid, {
        boundary,
        deletedSubs,
        excludeAssignmentIds: APPLY ? [] : asgs.map((a) => a.id),
      });
      const cur = await prisma.mastery.findMany({
        where: { studentId: sid },
        select: { kpId: true, value: true },
      });
      const curMap = new Map(cur.map((m) => [m.kpId, m.value]));
      if (!plan.mastery.length && !plan.dropMasteryIds.length) {
        console.log("  （无变化）");
      }
      for (const m of plan.mastery) {
        const old = curMap.get(m.kpId);
        console.log(
          `  kp=${m.kpId} value ${old?.toFixed(4) ?? "（无行）"} → ${m.value.toFixed(4)}（重建历史点 ${m.points.length} 个${m.existingId ? "" : "，新建行"}）`
        );
      }
      if (plan.dropMasteryIds.length) console.log(`  删除纯 e2e 掌握度行 ${plan.dropMasteryIds.length} 条`);
      const wqCur = await prisma.wrongQuestion.findMany({ where: { studentId: sid }, select: { questionId: true, wrongCount: true } });
      console.log(`  错题本：现有 ${wqCur.length} 条 → 重建后 ${plan.wrongUpserts.length} 条（删 ${plan.wrongDeletes.length}）`);
      for (const w of plan.wrongUpserts) {
        const old = wqCur.find((x) => x.questionId === w.questionId);
        if (!old || old.wrongCount !== w.wrongCount) {
          console.log(`    q=${w.questionId} wrongCount ${old?.wrongCount ?? 0} → ${w.wrongCount}`);
        }
      }
    }
  }

  if (APPLY) {
    console.log("\n写库中…");
    const res = await cleanupAllE2e(prisma);
    console.log(
      `\n✅ 已清理：目标 ${res.goals} 条、作业 ${res.assignments} 条、分享链接 ${res.links} 条；恢复学生 ${res.studentIds.length} 名`
    );
  } else {
    console.log("\n（预览模式——确认无误后加 --apply 执行）");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
