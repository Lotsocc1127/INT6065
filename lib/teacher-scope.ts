/**
 * 教师权限范围（班主任/科目教师）——全站单一权威：
 * - 班主任（User.headTeacherClassId）：只看本班（全科目），可管理本班学生
 * - 科目教师（User.subjectId）：只看本学科（全年级），学生管理/目标申诉只读受限
 * - 未绑定教师与 ADMIN/STUDENT/PARENT：范围 null = 全量（向后兼容）
 * 绑定在登录时进 JWT（lib/auth.ts）；管理员改绑定后该教师下次登录生效。
 * 所有 TEACHER 路由在 requireApiUser 之后调用本模块的 resolve/assert 助手；
 * 越界一律抛 AuthError(403)，由 lib/api.ts 的 fail() 统一转成 403 响应。
 */
import { Prisma, Role } from "@prisma/client";
import { AuthError } from "./auth";
import { prisma } from "./prisma";

/** 路由里可传入的结构化会话用户（session.user 兼容） */
export interface ScopeUser {
  role?: Role | null;
  headTeacherClassId?: string | null;
  subjectId?: string | null;
  subjectCode?: string | null;
}

export interface TeacherScope {
  headTeacherClassId: string | null;
  subjectId: string | null;
  subjectCode: string | null;
}

/** 计算教师范围；null = 不受限（ADMIN/学生/未绑定教师） */
export function getTeacherScope(user: ScopeUser | null | undefined): TeacherScope | null {
  if (!user || user.role !== Role.TEACHER) return null;
  if (!user.headTeacherClassId && !user.subjectId) return null;
  return {
    headTeacherClassId: user.headTeacherClassId ?? null,
    subjectId: user.subjectId ?? null,
    subjectCode: user.subjectCode ?? null,
  };
}

function deny(message: string): never {
  const err = new AuthError(message);
  err.status = 403;
  throw err;
}

/** 解析请求的 classId：班主任强制本班（显式越界 403）；其余返回 requested ?? undefined */
export function resolveClassId(user: ScopeUser, requested?: string | null): string | undefined {
  const scope = getTeacherScope(user);
  if (scope?.headTeacherClassId) {
    if (requested && requested !== scope.headTeacherClassId) deny("无权访问其他班级的数据");
    return scope.headTeacherClassId;
  }
  return requested ?? undefined;
}

/**
 * 解析请求的 subjectCode：科目教师强制本学科（显式越界 403）；其余返回 requested ?? undefined。
 * 返回的是 Subject.code（"math" 等），下游沿用既有 code→id 查询模式。
 */
export function resolveSubjectCode(user: ScopeUser, requested?: string | null): string | undefined {
  const scope = getTeacherScope(user);
  if (scope?.subjectId) {
    if (requested && requested !== scope.subjectCode) deny("无权访问其他学科的数据");
    return scope.subjectCode ?? undefined;
  }
  return requested ?? undefined;
}

/** 作业级断言：班主任限本班；科目教师限本学科；null 范围直接放行 */
export function assertTeacherCanAccessAssignment(
  user: ScopeUser,
  a: { classId: string; subjectId: string }
): void {
  const scope = getTeacherScope(user);
  if (!scope) return;
  if (scope.headTeacherClassId && a.classId !== scope.headTeacherClassId)
    deny("无权访问其他班级的作业");
  if (scope.subjectId && a.subjectId !== scope.subjectId) deny("无权访问其他学科的作业");
}

/** 学生级断言：班主任限本班学生；科目教师/未绑定/ADMIN 放行 */
export function assertTeacherCanAccessStudent(
  user: ScopeUser,
  s: { classId: string | null }
): void {
  const scope = getTeacherScope(user);
  if (!scope) return;
  if (scope.headTeacherClassId && s.classId !== scope.headTeacherClassId)
    deny("无权访问其他班级的学生");
}

/** 学生管理（增/改/删/重置密码）：科目教师 403 */
export function assertTeacherCanManageStudents(user: ScopeUser): void {
  const scope = getTeacherScope(user);
  if (scope?.subjectId) deny("科目教师无权管理学生账号");
}

/** 班级级事务（目标申诉等无学科归属的数据）：科目教师 403 */
export function assertNotSubjectTeacher(user: ScopeUser, message = "科目教师无权处理该数据"): void {
  const scope = getTeacherScope(user);
  if (scope?.subjectId) deny(message);
}

/** 班级列表过滤：班主任仅本班 */
export function classListWhere(user: ScopeUser): Prisma.ClassWhereInput {
  const scope = getTeacherScope(user);
  return scope?.headTeacherClassId ? { id: scope.headTeacherClassId } : {};
}

/** 科目列表过滤：科目教师仅本学科 */
export function subjectListWhere(user: ScopeUser): Prisma.SubjectWhereInput {
  const scope = getTeacherScope(user);
  return scope?.subjectId ? { id: scope.subjectId } : {};
}

/** 管理员设置教师绑定：{classId?, subjectId?} 键存在语义（null/空 = 清除）。
 * 互斥：两者同时非空 → 400；设其一非空时另一自动清除。
 * 返回可空的绑定字段（不含未出现的键）；非法输入抛 AuthError(status 400)。 */
export async function resolveBindingInput(body: {
  classId?: string | null;
  subjectId?: string | null;
}): Promise<{ headTeacherClassId?: string | null; subjectId?: string | null }> {
  const hasClass = Object.prototype.hasOwnProperty.call(body, "classId");
  const hasSubject = Object.prototype.hasOwnProperty.call(body, "subjectId");
  const classId = hasClass ? (body.classId || null) : undefined;
  const subjectId = hasSubject ? (body.subjectId || null) : undefined;
  if (classId && subjectId) {
    const err = new AuthError("班级与科目互斥，只能绑定其一");
    err.status = 400;
    throw err;
  }
  const out: { headTeacherClassId?: string | null; subjectId?: string | null } = {};
  if (classId !== undefined) {
    if (classId) {
      const cls = await prisma.class.findUnique({ where: { id: classId } });
      if (!cls) {
        const err = new AuthError("班级不存在");
        err.status = 400;
        throw err;
      }
    }
    out.headTeacherClassId = classId;
    if (classId) out.subjectId = null; // 绑定班主任时清除科目绑定
  }
  if (subjectId !== undefined) {
    if (subjectId) {
      const subj = await prisma.subject.findUnique({ where: { id: subjectId } });
      if (!subj) {
        const err = new AuthError("科目不存在");
        err.status = 400;
        throw err;
      }
    }
    out.subjectId = subjectId;
    if (subjectId) out.headTeacherClassId = null; // 绑定科目教师时清除班级绑定
  }
  return out;
}
