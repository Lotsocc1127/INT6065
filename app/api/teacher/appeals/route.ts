import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertNotSubjectTeacher, resolveClassId } from "@/lib/teacher-scope";

export const dynamic = "force-dynamic";

/**
 * GET /api/teacher/appeals —— 学习目标待复核申诉队列
 *
 * 班主任仅本班（resolveClassId 强制，显式越界 403）；科目教师 403（目标无学科归属）；
 * 未绑定教师/管理员可 ?classId= 筛选（缺省全部）。
 * 不提供 subject 筛选：LearningGoal.kpId 可空且无外键，按科目过滤会静默隐藏
 * 全部自由文本目标（含 seed 造的全部目标）。
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireApiUser(["TEACHER", "ADMIN"]);
    assertNotSubjectTeacher(session.user, "科目教师无权查看目标申诉");
    const sp = req.nextUrl.searchParams;
    const classId = resolveClassId(session.user, sp.get("classId"));
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
        studentNo: g.student.studentNo,
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
