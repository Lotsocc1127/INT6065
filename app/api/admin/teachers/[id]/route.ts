import { NextRequest } from "next/server";
import { Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** PATCH /api/admin/teachers/:id —— 重置教师密码 {password}（仅管理员） */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireApiUser(["ADMIN"]);
    const teacher = await prisma.user.findUnique({ where: { id: params.id } });
    if (!teacher || teacher.role !== Role.TEACHER) return ok({ error: "教师不存在" }, 404);

    const body = await req.json();
    const password = String(body?.password ?? "").trim();
    if (password.length < 4) return ok({ error: "密码至少 4 位" }, 400);

    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.update({ where: { id: params.id }, data: { password: passwordHash } });
    return ok({ id: params.id });
  } catch (e) {
    return fail(e);
  }
}
