import { NextRequest } from "next/server";
import { Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { validatePassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import {
  assertTeacherCanAccessStudent,
  assertTeacherCanManageStudents,
} from "@/lib/teacher-scope";

export const dynamic = "force-dynamic";

/** PATCH /api/teacher/students/:id —— 重置学生密码 {password}（教师/管理员）
 * 班主任限本班学生；科目教师 403（只读） */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireApiUser(["TEACHER", "ADMIN"]);
    assertTeacherCanManageStudents(session.user);
    const student = await prisma.user.findUnique({ where: { id: params.id } });
    if (!student || student.role !== Role.STUDENT) return ok({ error: "学生不存在" }, 404);
    assertTeacherCanAccessStudent(session.user, student);

    const body = await req.json();
    const password = String(body?.password ?? "").trim();
    const perr = validatePassword(password);
    if (perr) return ok({ error: perr }, 400);

    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.update({ where: { id: params.id }, data: { password: passwordHash } });
    return ok({ id: params.id });
  } catch (e) {
    return fail(e);
  }
}

/** DELETE /api/teacher/students/:id —— 移出班级（classId 置空，历史记录保留；教师/管理员）
 * 班主任限本班学生；科目教师 403（只读） */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireApiUser(["TEACHER", "ADMIN"]);
    assertTeacherCanManageStudents(session.user);
    const student = await prisma.user.findUnique({ where: { id: params.id } });
    if (!student || student.role !== Role.STUDENT) return ok({ error: "学生不存在" }, 404);
    assertTeacherCanAccessStudent(session.user, student);

    await prisma.user.update({ where: { id: params.id }, data: { classId: null } });
    return ok({ id: params.id });
  } catch (e) {
    return fail(e);
  }
}
