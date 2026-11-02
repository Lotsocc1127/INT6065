import { NextRequest } from "next/server";
import { Role } from "@prisma/client";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateShareToken, hashShareToken } from "@/lib/share";
import {
  assertTeacherCanAccessStudent,
  assertTeacherCanManageStudents,
  getTeacherScope,
} from "@/lib/teacher-scope";

export const dynamic = "force-dynamic";

/**
 * 家长分享链接（教师端管理）：
 * - GET ?studentId=  列表（不含原始 token）；班主任仅本班学生
 * - POST {studentId} 创建（raw token 仅此一次返回）；班主任限本班、科目教师 403
 * - DELETE ?id=      撤销；同上权限
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireApiUser(["TEACHER", "ADMIN"]);
    const scope = getTeacherScope(session.user);
    const studentId = req.nextUrl.searchParams.get("studentId") ?? "";
    if (studentId && scope?.headTeacherClassId) {
      const student = await prisma.user.findUnique({
        where: { id: studentId },
        select: { classId: true },
      });
      if (!student) return ok({ error: "学生不存在" }, 404);
      assertTeacherCanAccessStudent(session.user, student);
    }
    const links = await prisma.shareLink.findMany({
      where: studentId
        ? { studentId }
        : scope?.headTeacherClassId
          ? { student: { classId: scope.headTeacherClassId } }
          : {},
      select: { id: true, createdAt: true, revoked: true, revokedAt: true, lastViewedAt: true },
      orderBy: { createdAt: "desc" },
    });
    return ok({ links });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireApiUser(["TEACHER", "ADMIN"]);
    assertTeacherCanManageStudents(session.user);
    const body = await req.json().catch(() => ({}));
    const studentId = String(body?.studentId ?? "").trim();
    if (!studentId) return ok({ error: "缺少 studentId" }, 400);

    const student = await prisma.user.findUnique({ where: { id: studentId } });
    if (!student) return ok({ error: "学生不存在" }, 404);
    if (student.role !== Role.STUDENT) return ok({ error: "只能为学生生成分享链接" }, 400);
    assertTeacherCanAccessStudent(session.user, student);

    const raw = generateShareToken();
    const link = await prisma.shareLink.create({
      data: {
        tokenHash: hashShareToken(raw),
        studentId,
        createdBy: session.user.id,
      },
    });
    return ok({ link: { id: link.id, url: `/share/${raw}`, createdAt: link.createdAt } }, 201);
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireApiUser(["TEACHER", "ADMIN"]);
    assertTeacherCanManageStudents(session.user);
    const id = req.nextUrl.searchParams.get("id") ?? "";
    if (!id) return ok({ error: "缺少 id" }, 400);
    const link = await prisma.shareLink.findUnique({
      where: { id },
      include: { student: { select: { classId: true } } },
    });
    if (!link) return ok({ error: "链接不存在" }, 404);
    assertTeacherCanAccessStudent(session.user, link.student);
    if (link.revoked) return ok({ revoked: true });
    await prisma.shareLink.update({
      where: { id },
      data: { revoked: true, revokedAt: new Date() },
    });
    return ok({ revoked: true });
  } catch (e) {
    return fail(e);
  }
}
