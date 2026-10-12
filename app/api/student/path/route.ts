import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { parseArr } from "@/lib/json";
import { buildPath } from "@/lib/mastery";
import { prisma } from "@/lib/prisma";

/** GET /api/student/path?subject= —— 个性化学习路径（拓扑补前置，6.4） */
export async function GET(req: NextRequest) {
  try {
    const session = await requireApiUser(["STUDENT"]);
    const subjectCode = req.nextUrl.searchParams.get("subject") ?? "math";
    const subject = await prisma.subject.findUnique({ where: { code: subjectCode } });
    if (!subject) return ok({ error: "科目不存在" }, 404);

    const kps = await prisma.knowledgePoint.findMany({
      where: { subjectId: subject.id },
      orderBy: { code: "asc" },
    });
    const masteries = await prisma.mastery.findMany({
      where: { studentId: session.user.id, subjectId: subject.id },
    });
    const masteryMap = new Map(masteries.map((m) => [m.kpId, m.value]));

    const path = buildPath(
      kps.map((k) => ({ id: k.id, prereqIds: parseArr(k.prereqIds) })),
      masteryMap
    );
    const kpById = new Map(kps.map((k) => [k.id, k]));
    const items = path.map((node) => {
      const kp = kpById.get(node.id)!;
      const value = masteryMap.get(node.id) ?? 0;
      return {
        id: kp.id,
        code: kp.code,
        name: kp.name,
        description: kp.description,
        prereqIds: parseArr(kp.prereqIds),
        mastery: value,
        mastered: value >= 0.8,
      };
    });
    const next = items.find((i) => !i.mastered) ?? null;
    return ok({ items, next, done: !items.length });
  } catch (e) {
    return fail(e);
  }
}
