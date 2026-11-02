import { NextRequest } from "next/server";
import { Prisma, Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { validatePassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { resolveBindingInput } from "@/lib/teacher-scope";

export const dynamic = "force-dynamic";

const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "123456";

/** GET /api/admin/teachers —— 教师账号列表（仅管理员，含班主任/科目绑定） */
export async function GET() {
  try {
    await requireApiUser(["ADMIN"]);
    const teachers = await prisma.user.findMany({
      where: { role: Role.TEACHER },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        headTeacherClassId: true,
        subjectId: true,
        headTeacherClass: { select: { name: true } },
        subject: { select: { code: true, name: true } },
      },
    });
    return ok(
      teachers.map((t) => ({
        id: t.id,
        name: t.name,
        headTeacherClassId: t.headTeacherClassId,
        headTeacherClassName: t.headTeacherClass?.name ?? null,
        subjectId: t.subjectId,
        subjectCode: t.subject?.code ?? null,
        subjectName: t.subject?.name ?? null,
      }))
    );
  } catch (e) {
    return fail(e);
  }
}

/** POST /api/admin/teachers —— 创建教师账号 {name, password?, classId?, subjectId?}（仅管理员）
 * classId/subjectId 为班主任/科目教师绑定（互斥）；留空 = 未绑定（全量权限） */
export async function POST(req: NextRequest) {
  try {
    await requireApiUser(["ADMIN"]);
    const body = await req.json();
    const name = String(body?.name ?? "").trim();
    const password = String(body?.password ?? "").trim() || DEMO_PASSWORD;
    if (!name) return ok({ error: "请填写教师姓名" }, 400);
    const perr = validatePassword(password);
    if (perr) return ok({ error: perr }, 400);

    const binding = await resolveBindingInput(body);
    const passwordHash = await bcrypt.hash(password, 10);
    let teacher;
    try {
      teacher = await prisma.user.create({
        data: { name, role: Role.TEACHER, password: passwordHash, ...binding },
      });
    } catch (e) {
      // 该班级已绑定其他班主任（headTeacherClassId 唯一约束）
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return ok({ error: "该班级已绑定其他班主任" }, 400);
      }
      throw e;
    }
    return ok({ id: teacher.id, name: teacher.name }, 201);
  } catch (e) {
    return fail(e);
  }
}
