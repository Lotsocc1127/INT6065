import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { goalDto } from "@/lib/goals";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/goals/:id —— 标记完成 或 提出申诉
 *  - { done: boolean }                     标记完成 / 取消完成
 *  - { action: "appeal", reason?: string } 提出申诉（理由选填）
 * 不变量：appealStatus === PENDING 期间 done 锁定为 false（复核中不允许自行标记完成）
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireApiUser(["STUDENT"]);
    const goal = await prisma.learningGoal.findUnique({ where: { id: params.id } });
    if (!goal || goal.studentId !== session.user.id) return ok({ error: "目标不存在" }, 404);
    const body = await req.json();

    // ---- 提出申诉 ----
    if (body?.action === "appeal") {
      if (goal.done) return ok({ error: "目标已完成，无法提出申诉" }, 400);
      if (goal.appealStatus === "PENDING") return ok({ error: "该目标已在复核中，请等待老师处理" }, 400);
      if (goal.appealStatus === "ACCEPTED") return ok({ error: "该申诉已通过，无需重复提交" }, 400);
      // 理由选填；截断避免超长内容
      const reason = String(body?.reason ?? "").trim().slice(0, 500);
      const updated = await prisma.learningGoal.update({
        where: { id: goal.id },
        data: {
          appealStatus: "PENDING",
          appealReason: reason || null,
          appealRequestedAt: new Date(),
          // 被驳回后再次申诉时，清掉上一次的裁决信息
          appealReply: null,
          appealResolvedAt: null,
          appealResolvedBy: null,
        },
      });
      return ok(goalDto(updated));
    }

    // ---- 标记完成 / 取消完成 ----
    if (typeof body?.done === "boolean") {
      if (body.done && goal.appealStatus === "PENDING") {
        return ok({ error: "申诉复核中，暂不能标记完成" }, 400);
      }
      const updated = await prisma.learningGoal.update({
        where: { id: goal.id },
        data: { done: body.done },
      });
      return ok(goalDto(updated));
    }

    return ok({ error: "缺少操作参数（done 或 action=appeal）" }, 400);
  } catch (e) {
    return fail(e);
  }
}
