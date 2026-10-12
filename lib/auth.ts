import { getServerSession, type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import type { Role } from "@prisma/client";
import { prisma } from "./prisma";

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "演示账号",
      credentials: {
        userId: { label: "用户", type: "text" },
        password: { label: "密码", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.userId || !credentials?.password) return null;
        const user = await prisma.user.findUnique({ where: { id: credentials.userId } });
        if (!user) return null;
        // bcrypt 哈希校验（bcryptjs 为纯 JS 实现，兼容 Vercel 等 serverless 环境）
        const okHash = user.password.startsWith("$2")
          ? await bcrypt.compare(credentials.password, user.password)
          : false;
        // 兼容旧种子明文密码（仅开发期遗留；生产请确保全部为哈希）
        const okLegacy = !user.password.startsWith("$2") && user.password === credentials.password;
        if (!okHash && !okLegacy) return null;
        return { id: user.id, name: user.name, role: user.role, classId: user.classId };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.classId = user.classId;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as Role;
        session.user.classId = (token.classId as string | null) ?? null;
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};

export const getSession = () => getServerSession(authOptions);

export class AuthError extends Error {
  status = 401;
}

/** API 路由鉴权：返回当前会话；未登录/角色不符时抛 AuthError（route 中 catch 后返回 401/403） */
export async function requireApiUser(roles?: Role[]) {
  const session = await getSession();
  if (!session?.user) throw new AuthError("未登录");
  if (roles && !roles.includes(session.user.role)) {
    const err = new AuthError("无权限");
    err.status = 403;
    throw err;
  }
  return session;
}
