import { NextRequest } from "next/server";
import { Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "123456";

/** GET /api/admin/teachers —— 教师账号列表（仅管理员） */
export async function GET() {
  try {
    await requireApiUser(["ADMIN"]);
    const teachers = await prisma.user.findMany({
      where: { role: Role.TEACHER },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    return ok(teachers.map((t) => ({ id: t.id, name: t.name })));
  } catch (e) {
    return fail(e);
  }
}

/** POST /api/admin/teachers —— 创建教师账号 {name, password?}（仅管理员） */
export async function POST(req: NextRequest) {
  try {
    await requireApiUser(["ADMIN"]);
    const body = await req.json();
    const name = String(body?.name ?? "").trim();
    const password = String(body?.password ?? "").trim() || DEMO_PASSWORD;
    if (!name) return ok({ error: "请填写教师姓名" }, 400);
    if (password.length < 4) return ok({ error: "密码至少 4 位" }, 400);

    const passwordHash = await bcrypt.hash(password, 10);
    const teacher = await prisma.user.create({
      data: { name, role: Role.TEACHER, password: passwordHash },
    });
    return ok({ id: teacher.id, name: teacher.name }, 201);
  } catch (e) {
    return fail(e);
  }
}
