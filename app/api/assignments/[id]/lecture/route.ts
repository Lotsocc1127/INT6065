import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { buildLectureData } from "@/lib/lecture";
import { prisma } from "@/lib/prisma";
import { assertTeacherCanAccessAssignment } from "@/lib/teacher-scope";

export const dynamic = "force-dynamic";

/** GET /api/assignments/:id/lecture —— 课堂讲评数据（教师端）：全班逐题聚合统计，典型错误作答脱敏（仅学号）
 * 权限：班主任限本班、科目教师限本学科（越界 403） */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireApiUser(["TEACHER", "ADMIN"]);
    const assignment = await prisma.assignment.findUnique({
      where: { id: params.id },
      select: { classId: true, subjectId: true },
    });
    if (!assignment) return ok({ error: "作业不存在" }, 404);
    assertTeacherCanAccessAssignment(session.user, assignment);
    const data = await buildLectureData(params.id);
    if (!data) return ok({ error: "作业不存在" }, 404);
    return ok(data);
  } catch (e) {
    return fail(e);
  }
}
