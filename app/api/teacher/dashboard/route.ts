import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { aggregateDashboard } from "@/lib/dashboard";
import { getTeacherScope, resolveClassId, resolveSubjectCode } from "@/lib/teacher-scope";

export const dynamic = "force-dynamic";

/** GET /api/teacher/dashboard?subject=&classId= —— 班级看板：聚合掌握度、热力图矩阵、分层诊断
 * 聚合逻辑在 lib/dashboard.ts（与 Excel 导出共用）
 * 权限：班主任限本班（classes 仅本班）、科目教师限本学科（resolve 助手强制，越界 403） */
export async function GET(req: NextRequest) {
  try {
    const session = await requireApiUser(["TEACHER", "ADMIN"]);
    const sp = req.nextUrl.searchParams;
    const scope = getTeacherScope(session.user);
    const res = await aggregateDashboard({
      subjectCode: resolveSubjectCode(session.user, sp.get("subject")) ?? "math",
      classId: resolveClassId(session.user, sp.get("classId")),
      visibleClassIds: scope?.headTeacherClassId ? [scope.headTeacherClassId] : undefined,
    });
    if (!res.ok) return ok({ error: res.error }, 404);
    return ok(res.dto);
  } catch (e) {
    return fail(e);
  }
}
