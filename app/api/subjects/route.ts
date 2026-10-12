import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** GET /api/subjects —— 科目列表（科目切换框架的数据源） */
export async function GET() {
  try {
    await requireApiUser();
    const subjects = await prisma.subject.findMany({
      orderBy: { code: "asc" },
      include: { _count: { select: { knowledgePoints: true, questions: true } } },
    });
    return ok(
      subjects.map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        kpCount: s._count.knowledgePoints,
        questionCount: s._count.questions,
      }))
    );
  } catch (e) {
    return fail(e);
  }
}
