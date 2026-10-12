import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** PATCH /api/goals/:id —— 标记完成 / 对标签提出申诉（challenged） */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireApiUser(["STUDENT"]);
    const goal = await prisma.learningGoal.findUnique({ where: { id: params.id } });
    if (!goal || goal.studentId !== session.user.id) return ok({ error: "目标不存在" }, 404);
    const body = await req.json();
    const data: { done?: boolean; challenged?: boolean } = {};
    if (typeof body?.done === "boolean") data.done = body.done;
    if (typeof body?.challenged === "boolean") data.challenged = body.challenged;
    const updated = await prisma.learningGoal.update({ where: { id: goal.id }, data });
    return ok({ id: updated.id, done: updated.done, challenged: updated.challenged });
  } catch (e) {
    return fail(e);
  }
}
