/**
 * 幂等创建管理员账号：现有数据库不重灌时执行一次即可。
 * 运行：npx tsx scripts/ensure-admin.ts
 */
import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const password = process.env.DEMO_PASSWORD ?? "123456";
  const existing = await prisma.user.findFirst({ where: { role: Role.ADMIN } });
  if (existing) {
    console.log(`管理员已存在（${existing.name}），跳过`);
    return;
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const admin = await prisma.user.create({
    data: { name: "管理员", role: Role.ADMIN, password: passwordHash },
  });
  console.log(`已创建管理员账号：${admin.name}（初始密码 ${password}）`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
