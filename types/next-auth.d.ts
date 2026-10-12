import type { DefaultSession } from "next-auth";
import type { Role } from "@prisma/client";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      classId: string | null;
    } & DefaultSession["user"];
  }
  interface User {
    role?: Role;
    classId?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: Role;
    classId?: string | null;
  }
}
