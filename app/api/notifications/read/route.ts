import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** POST /api/notifications/read —— 标记已读：{ids?: string[]}；不带 ids = 全部已读 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireApiUser();
    const body = await req.json().catch(() => ({}));
    const ids = Array.isArray(body?.ids) ? body.ids.map(String).filter(Boolean) : [];
    const updated = await prisma.notification.updateMany({
      where: {
        userId: session.user.id,
        readAt: null,
        ...(ids.length ? { id: { in: ids } } : {}),
      },
      data: { readAt: new Date() },
    });
    return ok({ updated: updated.count });
  } catch (e) {
    return fail(e);
  }
}
