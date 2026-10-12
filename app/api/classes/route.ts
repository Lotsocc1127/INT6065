import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** GET /api/classes —— 班级列表（教师布置作业/看板选择用） */
export async function GET() {
  try {
    await requireApiUser();
    const classes = await prisma.class.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { students: true } } },
    });
    return ok(
      classes.map((c) => ({ id: c.id, name: c.name, studentCount: c._count.students }))
    );
  } catch (e) {
    return fail(e);
  }
}
