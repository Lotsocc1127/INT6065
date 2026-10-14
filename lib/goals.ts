import type { LearningGoal } from "@prisma/client";

/**
 * 学习目标对外 DTO。
 * `challenged` 是派生字段（= 待教师复核），保留旧字段名以便既有消费端零改动。
 */
export function goalDto(g: LearningGoal) {
  return {
    id: g.id,
    content: g.content,
    kpId: g.kpId,
    done: g.done,
    appealStatus: g.appealStatus,
    appealReason: g.appealReason,
    appealReply: g.appealReply,
    appealRequestedAt: g.appealRequestedAt,
    appealResolvedAt: g.appealResolvedAt,
    challenged: g.appealStatus === "PENDING",
    createdAt: g.createdAt,
  };
}
