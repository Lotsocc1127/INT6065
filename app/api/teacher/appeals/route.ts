import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/teacher/appeals —— 学习目标待复核申诉队列
 *
 * ?classId= 仅作 UI 筛选；本应用没有教师↔班级绑定，故不做权限范围校验
 * （与 /api/review-queue 一致，所有教师可见全部班级）。
 * 不提供 subject 筛选：LearningGoal.kpId 可空且无外键，按科目过滤会静默隐藏
 * 全部自由文本目标（含 seed 造的全部目标）。
 */
export async function GET(req: NextRequest) {
  try {
    await requireApiUser(["TEACHER", "ADMIN"]);
    const sp = req.nextUrl.searchParams;
    const classId = sp.get("classId") || undefined;
    const countOnly = sp.get("countOnly") === "1";

    const where = {
      appealStatus: "PENDING" as const,
      ...(classId ? { student: { classId } } : {}),
    };

    if (countOnly) {
      const count = await prisma.learningGoal.count({ where });
      return ok({ count });
    }

    const goals = await prisma.learningGoal.findMany({
      where,
      orderBy: { appealRequestedAt: "asc" }, // 先申诉先处理
      include: { student: { include: { class: true } } },
    });

    return ok({
      count: goals.length,
      items: goals.map((g) => ({
        id: g.id,
        studentId: g.studentId,
        studentName: g.student.name,
        className: g.student.class?.name ?? "未分班",
        content: g.content,
        kpId: g.kpId,
        done: g.done,
        appealReason: g.appealReason,
        appealRequestedAt: g.appealRequestedAt,
      })),
    });
  } catch (e) {
    return fail(e);
  }
}
