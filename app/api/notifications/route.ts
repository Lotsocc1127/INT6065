import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** GET /api/notifications?countOnly=1 —— 未读数；否则本人通知列表（最新 50 条） */
export async function GET(req: NextRequest) {
  try {
    const session = await requireApiUser();
    const sp = req.nextUrl.searchParams;
    if (sp.get("countOnly") === "1") {
      const count = await prisma.notification.count({
        where: { userId: session.user.id, readAt: null },
      });
      return ok({ count });
    }
    const rows = await prisma.notification.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return ok({
      items: rows.map((r) => ({
        id: r.id,
        type: r.type,
        title: r.title,
        body: r.body,
        link: r.link,
        readAt: r.readAt,
        createdAt: r.createdAt,
      })),
    });
  } catch (e) {
    return fail(e);
  }
}
