/**
 * 站内通知工具：
 * - 教师侧事件（新提交/申诉）按教师绑定定向：事件班级的班主任 ∪ 事件科目的科目教师 ∪ 未绑定教师
 *   （findTeacherIdsFor）；不再全员广播
 * - createMany 为单条批量语句，Neon Pooled 连接安全；收件人查询在调用方事务外预读
 */
import { Prisma, Role } from "@prisma/client";
import { prisma } from "./prisma";

export interface NotificationInput {
  type: "assignment" | "submission" | "reviewed" | "appeal_filed" | "appeal_resolved";
  title: string;
  body: string;
  link?: string;
}

/**
 * 事件相关教师收件人：班主任（所带班级）∪ 科目教师（所属学科）∪ 未绑定教师。
 * classId/subjectId 至少传一个；目标申诉类无学科事件只传 classId。
 */
export async function findTeacherIdsFor(opts: {
  classId?: string;
  subjectId?: string;
}): Promise<string[]> {
  const rows = await prisma.user.findMany({
    where: {
      role: Role.TEACHER,
      OR: [
        ...(opts.classId ? [{ headTeacherClassId: opts.classId }] : []),
        ...(opts.subjectId ? [{ subjectId: opts.subjectId }] : []),
        { headTeacherClassId: null, subjectId: null },
      ],
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** 向一组用户批量建通知（单语句）；返回可直接放入 $transaction([...]) 的 op */
export function notificationOps(
  userIds: string[],
  n: NotificationInput
): Prisma.PrismaPromise<unknown> {
  return prisma.notification.createMany({
    data: userIds.map((userId) => ({ userId, ...n })),
  });
}
