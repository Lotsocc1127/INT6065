/**
 * 站内通知工具：
 * - 教师侧事件（新提交/申诉）通知全体 TEACHER——MVP 无「教师-班级」绑定、Assignment 无 createdBy，
 *   暂全员广播；未来可细化为「布置人/任课教师」定向
 * - createMany 为单条批量语句，Neon Pooled 连接安全，可塞进既有批量事务 ops 数组
 */
import { Prisma, Role } from "@prisma/client";
import { prisma } from "./prisma";

export interface NotificationInput {
  type: "assignment" | "submission" | "reviewed" | "appeal_filed" | "appeal_resolved";
  title: string;
  body: string;
  link?: string;
}

export async function findTeacherIds(): Promise<string[]> {
  const rows = await prisma.user.findMany({ where: { role: Role.TEACHER }, select: { id: true } });
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

/** 向全体教师批量建通知（单语句）；调用前需已预读 teacherIds（事务外预读，Pooled 约束） */
export function teacherNotificationOps(
  teacherIds: string[],
  n: NotificationInput
): Prisma.PrismaPromise<unknown> {
  return notificationOps(teacherIds, n);
}
