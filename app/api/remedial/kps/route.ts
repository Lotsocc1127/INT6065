import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { aggregateRemedialKps } from "@/lib/remedial";

export const dynamic = "force-dynamic";

/** GET /api/remedial/kps —— 班级待补救知识点聚合（未攻克错题按 kp 归集） */
export async function GET(req: NextRequest) {
  try {
    await requireApiUser(["TEACHER", "ADMIN"]);
    const sp = req.nextUrl.searchParams;
    const subjectCode = sp.get("subject") ?? undefined;
    const classId = sp.get("classId") ?? undefined;

    const subject = subjectCode
      ? await prisma.subject.findUnique({ where: { code: subjectCode } })
      : null;
    if (!subject) return ok({ error: "科目不存在" }, 404);

    const items = await aggregateRemedialKps({ subjectId: subject.id, classId });
    return ok({ items });
  } catch (e) {
    return fail(e);
  }
}
