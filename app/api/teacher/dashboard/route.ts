import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { aggregateDashboard } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

/** GET /api/teacher/dashboard?subject=&classId= —— 班级看板：聚合掌握度、热力图矩阵、分层诊断
 * 聚合逻辑在 lib/dashboard.ts（与 Excel 导出共用） */
export async function GET(req: NextRequest) {
  try {
    await requireApiUser(["TEACHER", "ADMIN"]);
    const sp = req.nextUrl.searchParams;
    const res = await aggregateDashboard({
      subjectCode: sp.get("subject") ?? "math",
      classId: sp.get("classId") ?? undefined,
    });
    if (!res.ok) return ok({ error: res.error }, 404);
    return ok(res.dto);
  } catch (e) {
    return fail(e);
  }
}
