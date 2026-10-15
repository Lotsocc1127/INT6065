import { NextRequest } from "next/server";
import { Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { validatePassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { createStudentWithNo } from "@/lib/student-no";

export const dynamic = "force-dynamic";

const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "123456";

/** GET /api/teacher/students?classId= —— 班级学生列表（教师/管理员） */
export async function GET(req: NextRequest) {
  try {
    await requireApiUser(["TEACHER", "ADMIN"]);
    const sp = req.nextUrl.searchParams;
    const classes = await prisma.class.findMany({ orderBy: { name: "asc" } });
    const cls = sp.get("classId")
      ? classes.find((c) => c.id === sp.get("classId"))
      : classes[0];
    if (!cls) return ok({ error: "没有班级数据" }, 404);

    const students = await prisma.user.findMany({
      where: { role: Role.STUDENT, classId: cls.id },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        studentNo: true,
        classId: true,
        _count: { select: { goals: true } },
      },
    });
    return ok({
      class: { id: cls.id, name: cls.name },
      classes: classes.map((c) => ({ id: c.id, name: c.name })),
      students: students.map((s) => ({
        id: s.id,
        name: s.name,
        studentNo: s.studentNo,
        goalCount: s._count.goals,
      })),
    });
  } catch (e) {
    return fail(e);
  }
}

/** POST /api/teacher/students —— 添加学生 {name, password?, classId}（教师/管理员） */
export async function POST(req: NextRequest) {
  try {
    await requireApiUser(["TEACHER", "ADMIN"]);
    const body = await req.json();
    const name = String(body?.name ?? "").trim();
    const classId = String(body?.classId ?? "");
    const password = String(body?.password ?? "").trim() || DEMO_PASSWORD;
    if (!name) return ok({ error: "请填写学生姓名" }, 400);
    const perr = validatePassword(password);
    if (perr) return ok({ error: perr }, 400);
    const cls = await prisma.class.findUnique({ where: { id: classId } });
    if (!cls) return ok({ error: "班级不存在" }, 404);

    const passwordHash = await bcrypt.hash(password, 10);
    const student = await createStudentWithNo({ name, password: passwordHash, classId });
    return ok({ id: student.id, name: student.name, studentNo: student.studentNo }, 201);
  } catch (e) {
    return fail(e);
  }
}
