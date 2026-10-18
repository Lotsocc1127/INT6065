import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { goalDto } from "@/lib/goals";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/teacher/appeals/:goalId —— 复核学习目标申诉
 *  { decision: "accept" | "reject", reply?: string }
 *  采纳（accept）= 目标视为达成（done = true）；驳回（reject）= 目标恢复正常，学生可自行标记完成。
 */
export async function PATCH(req: NextRequest, { params }: { params: { goalId: string } }) {
  try {
    const session = await requireApiUser(["TEACHER", "ADMIN"]);
    const goal = await prisma.learningGoal.findUnique({ where: { id: params.goalId } });
    if (!goal) return ok({ error: "目标不存在" }, 404);
    if (goal.appealStatus !== "PENDING") return ok({ error: "该申诉已处理" }, 400);

    const body = await req.json();
    const decision = body?.decision;
    if (decision !== "accept" && decision !== "reject") {
      return ok({ error: "decision 必须为 accept 或 reject" }, 400);
    }
    const reply = typeof body?.reply === "string" ? body.reply.trim().slice(0, 500) : "";

    const updated = await prisma.learningGoal.update({
      where: { id: goal.id },
      data: {
        appealStatus: decision === "accept" ? "ACCEPTED" : "REJECTED",
        done: decision === "accept" ? true : goal.done,
        appealReply: reply || null,
        appealResolvedAt: new Date(),
        appealResolvedBy: session.user.id,
      },
    });

    // 通知：申诉处理结果 → 目标所属学生
    await prisma.notification.create({
      data: {
        userId: goal.studentId,
        type: "appeal_resolved",
        title: "申诉已处理",
        body: `你的目标「${goal.content.slice(0, 50)}」申诉已${
          decision === "accept" ? "通过（视为达成）" : "驳回"
        }${reply ? `：${reply.slice(0, 100)}` : ""}`,
        link: "/student/goals",
      },
    });
    return ok({ ...goalDto(updated), decision });
  } catch (e) {
    return fail(e);
  }
}
