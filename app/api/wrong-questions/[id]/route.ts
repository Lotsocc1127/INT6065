import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** PATCH /api/wrong-questions/:id —— 标记已掌握/未掌握 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireApiUser(["STUDENT"]);
    const body = await req.json();
    const wq = await prisma.wrongQuestion.findUnique({ where: { id: params.id } });
    if (!wq || wq.studentId !== session.user.id) return ok({ error: "错题不存在" }, 404);
    const updated = await prisma.wrongQuestion.update({
      where: { id: wq.id },
      data: { mastered: Boolean(body?.mastered) },
    });
    return ok({ id: updated.id, mastered: updated.mastered });
  } catch (e) {
    return fail(e);
  }
}
