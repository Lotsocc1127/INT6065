import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { aggregateRemedialKps } from "@/lib/remedial";
import { resolveClassId, resolveSubjectCode } from "@/lib/teacher-scope";

export const dynamic = "force-dynamic";

/** GET /api/remedial/kps —— 班级待补救知识点聚合（未攻克错题按 kp 归集）
 * 班主任限本班、科目教师限本学科（resolve 助手强制） */
export async function GET(req: NextRequest) {
  try {
    const session = await requireApiUser(["TEACHER", "ADMIN"]);
    const sp = req.nextUrl.searchParams;
    const subjectCode = resolveSubjectCode(session.user, sp.get("subject")) ?? "math";
    const classId = resolveClassId(session.user, sp.get("classId"));

    const subject = await prisma.subject.findUnique({ where: { code: subjectCode } });
    if (!subject) return ok({ error: "科目不存在" }, 404);

    const items = await aggregateRemedialKps({ subjectId: subject.id, classId });
    return ok({ items });
  } catch (e) {
    return fail(e);
  }
}
