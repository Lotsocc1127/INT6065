import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { buildLectureData } from "@/lib/lecture";

export const dynamic = "force-dynamic";

/** GET /api/assignments/:id/lecture —— 课堂讲评数据（教师端）：全班逐题聚合统计，典型错误作答脱敏（仅学号） */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireApiUser(["TEACHER", "ADMIN"]);
    const data = await buildLectureData(params.id);
    if (!data) return ok({ error: "作业不存在" }, 404);
    return ok(data);
  } catch (e) {
    return fail(e);
  }
}
