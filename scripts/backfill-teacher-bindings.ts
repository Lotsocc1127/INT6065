/**
 * 共享库回填教师绑定（班主任/科目教师）：
 * - 王老师→七年级(1)班、李老师→七年级(2)班、张老师→七年级(3)班（headTeacherClassId）
 * - 缺则创建科目教师：孙老师=数学、周老师=英语、吴老师=语文（subjectId）
 * 幂等：只填 null、不覆盖已有绑定、不删除；类已绑定其他教师时告警跳过。
 * 运行：npx tsx --env-file=.env scripts/backfill-teacher-bindings.ts
 */
import { Prisma, Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";

const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "123456";

const HEAD_BINDINGS: { teacherName: string; className: string }[] = [
  { teacherName: "王老师", className: "七年级(1)班" },
  { teacherName: "李老师", className: "七年级(2)班" },
  { teacherName: "张老师", className: "七年级(3)班" },
];

const SUBJECT_TEACHERS: { teacherName: string; subjectCode: string }[] = [
  { teacherName: "孙老师", subjectCode: "math" },
  { teacherName: "周老师", subjectCode: "english" },
  { teacherName: "吴老师", subjectCode: "chinese" },
];

async function main() {
  let updated = 0;
  let created = 0;
  let skipped = 0;

  for (const { teacherName, className } of HEAD_BINDINGS) {
    const [teacher, cls] = await Promise.all([
      prisma.user.findFirst({ where: { name: teacherName, role: Role.TEACHER } }),
      prisma.class.findFirst({ where: { name: className } }),
    ]);
    if (!teacher) {
      console.log(`跳过：未找到教师 ${teacherName}`);
      skipped++;
      continue;
    }
    if (!cls) {
      console.log(`跳过：未找到班级 ${className}`);
      skipped++;
      continue;
    }
    if (teacher.headTeacherClassId) {
      console.log(`跳过：${teacherName} 已有绑定`);
      skipped++;
      continue;
    }
    // 该班已绑定其他班主任（唯一约束撞车）→ 告警跳过，不覆盖
    const taken = await prisma.user.findFirst({
      where: { headTeacherClassId: cls.id, role: Role.TEACHER },
      select: { name: true },
    });
    if (taken) {
      console.log(`跳过：${className} 已绑定班主任 ${taken.name}，不改动 ${teacherName}`);
      skipped++;
      continue;
    }
    try {
      await prisma.user.update({
        where: { id: teacher.id },
        data: { headTeacherClassId: cls.id },
      });
      console.log(`已绑定：${teacherName} → ${className}`);
      updated++;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        console.log(`跳过：${teacherName} 绑定撞唯一约束（并发），不改动`);
        skipped++;
      } else {
        throw e;
      }
    }
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  for (const { teacherName, subjectCode } of SUBJECT_TEACHERS) {
    const subject = await prisma.subject.findUnique({ where: { code: subjectCode } });
    if (!subject) {
      console.log(`跳过：未找到科目 ${subjectCode}，不创建 ${teacherName}`);
      skipped++;
      continue;
    }
    const existing = await prisma.user.findFirst({
      where: { name: teacherName, role: Role.TEACHER },
    });
    if (!existing) {
      await prisma.user.create({
        data: { name: teacherName, role: Role.TEACHER, password: passwordHash, subjectId: subject.id },
      });
      console.log(`已创建：${teacherName}（科目·${subject.name}，密码 ${DEMO_PASSWORD}）`);
      created++;
      continue;
    }
    if (existing.subjectId) {
      console.log(`跳过：${teacherName} 已有科目绑定`);
      skipped++;
      continue;
    }
    await prisma.user.update({ where: { id: existing.id }, data: { subjectId: subject.id } });
    console.log(`已绑定：${teacherName} → ${subject.name}`);
    updated++;
  }

  console.log(`\n完成：绑定/更新 ${updated} 个，新建 ${created} 个，跳过 ${skipped} 个（幂等，可重复执行）`);
}

main()
  .catch((e) => {
    console.error("回填失败:", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
