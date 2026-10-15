import { NextRequest } from "next/server";
import { Prisma, Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { validatePassword } from "@/lib/password";
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
    const perr = validatePassword(password);
    if (perr) return ok({ error: perr }, 400);

    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.update({ where: { id: params.id }, data: { password: passwordHash } });
    return ok({ id: params.id });
  } catch (e) {
    return fail(e);
  }
}

/** DELETE /api/admin/teachers/:id —— 删除教师账号（仅管理员）。
 * 教师不持有任何业务数据行（作答/掌握度/目标/提交都挂在学生名下，
 * ShareLink.createdBy 与 LearningGoal.appealResolvedBy 是纯字符串），可安全删除。 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireApiUser(["ADMIN"]);
    const teacher = await prisma.user.findUnique({
      where: { id: params.id },
      include: {
        _count: { select: { answers: true, masteries: true, goals: true, submissions: true, shareLinks: true } },
      },
    });
    if (!teacher || teacher.role !== Role.TEACHER) return ok({ error: "教师不存在" }, 404);
    const { answers, masteries, goals, submissions, shareLinks } = teacher._count;
    if (answers + masteries + goals + submissions + shareLinks > 0) {
      return ok({ error: "该教师存在关联业务数据，无法删除" }, 409);
    }
    try {
      await prisma.user.delete({ where: { id: params.id } });
    } catch (e) {
      // 兜底：并发写入撞外键
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
        return ok({ error: "该教师存在关联业务数据，无法删除" }, 409);
      }
      throw e;
    }
    return ok({ id: params.id });
  } catch (e) {
    return fail(e);
  }
}
