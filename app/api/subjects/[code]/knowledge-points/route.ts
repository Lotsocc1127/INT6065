import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { parseArr } from "@/lib/json";
import { prisma } from "@/lib/prisma";

/** GET /api/subjects/:code/knowledge-points —— 知识图谱（含前置依赖） */
export async function GET(_req: NextRequest, { params }: { params: { code: string } }) {
  try {
    await requireApiUser();
    const subject = await prisma.subject.findUnique({ where: { code: params.code } });
    if (!subject) return ok({ error: "科目不存在" }, 404);
    const kps = await prisma.knowledgePoint.findMany({
      where: { subjectId: subject.id },
      orderBy: { code: "asc" },
    });
    const byId = new Map(kps.map((k) => [k.id, k]));
    return ok(
      kps.map((k) => ({
        id: k.id,
        code: k.code,
        name: k.name,
        description: k.description,
        prereqIds: parseArr(k.prereqIds),
        prereqCodes: parseArr(k.prereqIds)
          .map((id) => byId.get(id)?.code)
          .filter(Boolean),
      }))
    );
  } catch (e) {
    return fail(e);
  }
}
