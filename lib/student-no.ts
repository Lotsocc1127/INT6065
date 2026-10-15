import { Prisma, Role } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * 学号分配（仅 STUDENT）：全库数值最大 +1，两位零填充（"01"…"99"…）。
 * 全局递增而非班级内计数——班级内计数会与 studentNo 的 @unique 全局约束撞车
 * （同规模班级产生相同序列），全局递增跨班天然无冲突。
 * 并发竞态只发生在「同一瞬间两个创建」，create 撞 P2002 重试即可兜底。
 */
export async function allocateStudentNo(): Promise<string> {
  const rows = await prisma.user.findMany({
    where: { studentNo: { not: null } },
    select: { studentNo: true },
  });
  let max = 0;
  for (const r of rows) {
    const n = Number.parseInt(r.studentNo!, 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return String(max + 1).padStart(2, "0");
}

/** 创建学生并分配学号；撞唯一约束（P2002）时重新取号重试（最多 5 次）。 */
export async function createStudentWithNo(data: {
  name: string;
  password: string;
  classId: string;
}): Promise<{ id: string; name: string; studentNo: string }> {
  for (let attempt = 0; ; attempt++) {
    const studentNo = await allocateStudentNo();
    try {
      const stu = await prisma.user.create({
        data: { name: data.name, role: Role.STUDENT, classId: data.classId, password: data.password, studentNo },
      });
      return { id: stu.id, name: stu.name, studentNo };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && attempt < 4) {
        continue; // 学号被并发创建抢走，重新取号
      }
      throw e;
    }
  }
}
