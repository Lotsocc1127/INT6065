import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { buildGrowthSnapshot } from "@/lib/growth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** GET /api/growth?subject= —— 成长档案：统计、掌握度趋势、徽章 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireApiUser(["STUDENT"]);
    const subjectCode = req.nextUrl.searchParams.get("subject") ?? "math";
    const subject = await prisma.subject.findUnique({ where: { code: subjectCode } });
    if (!subject) return ok({ error: "科目不存在" }, 404);

    return ok(await buildGrowthSnapshot(session.user.id, subject.id));
  } catch (e) {
    return fail(e);
  }
}
