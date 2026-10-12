import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** GET /api/mastery?studentId=&subject= —— 掌握度（含历史轨迹） */
export async function GET(req: NextRequest) {
  try {
    const session = await requireApiUser();
    const sp = req.nextUrl.searchParams;
    const studentId = sp.get("studentId") ?? session.user.id;
    if (session.user.role === "STUDENT" && studentId !== session.user.id) {
      return ok({ error: "无权限查看他人掌握度" }, 403);
    }
    const subjectCode = sp.get("subject");

    const subject = subjectCode
      ? await prisma.subject.findUnique({ where: { code: subjectCode } })
      : null;
    const masteries = await prisma.mastery.findMany({
      where: { studentId, ...(subject ? { subjectId: subject.id } : {}) },
      include: { kp: true, history: { orderBy: { at: "asc" } } },
    });
    return ok(
      masteries.map((m) => ({
        kpId: m.kpId,
        kpCode: m.kp.code,
        kpName: m.kp.name,
        subjectCode,
        value: m.value,
        updatedAt: m.updatedAt,
        history: m.history.map((h) => ({ value: h.value, at: h.at })),
      }))
    );
  } catch (e) {
    return fail(e);
  }
}
