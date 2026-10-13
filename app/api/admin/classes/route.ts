import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** POST /api/admin/classes —— 新建班级 {name}（仅管理员） */
export async function POST(req: NextRequest) {
  try {
    await requireApiUser(["ADMIN"]);
    const body = await req.json();
    const name = String(body?.name ?? "").trim();
    if (!name) return ok({ error: "请填写班级名称" }, 400);

    const cls = await prisma.class.create({ data: { name } });
    return ok({ id: cls.id, name: cls.name }, 201);
  } catch (e) {
    return fail(e);
  }
}
