import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { goalDto } from "@/lib/goals";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** GET /api/goals —— 我的目标；POST —— 设定新目标 */
export async function GET() {
  try {
    const session = await requireApiUser(["STUDENT"]);
    const goals = await prisma.learningGoal.findMany({
      where: { studentId: session.user.id },
      orderBy: { createdAt: "desc" },
    });
    return ok(goals.map(goalDto));
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireApiUser(["STUDENT"]);
    const body = await req.json();
    const content = String(body?.content ?? "").trim();
    if (!content) return ok({ error: "目标内容不能为空" }, 400);
    const goal = await prisma.learningGoal.create({
      data: { studentId: session.user.id, content, kpId: body?.kpId ?? null },
    });
    return ok(goalDto(goal), 201);
  } catch (e) {
    return fail(e);
  }
}
