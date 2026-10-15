/**
 * 一次性回填脚本：为共享库中既有学生补学号（studentNo 为空者，全局递增、两位零填充）。
 * 幂等：可重复执行，第二遍为 no-op。
 * 运行：npx tsx --env-file=.env scripts/backfill-student-no.ts
 */
import { Role, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

async function main() {
  const existing = await prisma.user.findMany({
    where: { studentNo: { not: null } },
    select: { studentNo: true },
  });
  let counter = existing.reduce((m, r) => Math.max(m, Number.parseInt(r.studentNo!, 10) || 0), 0);

  const classes = await prisma.class.findMany({ orderBy: { name: "asc" } });
  let total = 0;
  for (const cls of classes) {
    const students = await prisma.user.findMany({
      where: { role: Role.STUDENT, classId: cls.id, studentNo: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    for (const s of students) {
      for (;;) {
        counter += 1;
        const studentNo = String(counter).padStart(2, "0");
        try {
          await prisma.user.update({ where: { id: s.id }, data: { studentNo } });
          break;
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
            continue; // 学号被并发创建抢占，换下一个号
          }
          throw e;
        }
      }
    }
    if (students.length) console.log(`${cls.name}：补 ${students.length} 人`);
    total += students.length;
  }
  console.log(`\n完成：共补 ${total} 名学生学号（当前全局最大 ${String(counter).padStart(2, "0")}）`);
}

main()
  .catch((e) => {
    console.error("回填失败:", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
