import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LoginForm } from "@/components/login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await getServerSession(authOptions);
  if (session?.user) {
    redirect(
      session.user.role === "STUDENT"
        ? "/student"
        : session.user.role === "ADMIN"
          ? "/admin"
          : "/teacher"
    );
  }
  const users = await prisma.user.findMany({
    orderBy: [{ role: "asc" }, { name: "asc" }],
    select: { id: true, name: true, role: true, class: { select: { name: true } } },
  });
  const list = users.map((u) => ({
    id: u.id,
    name: u.name,
    role: u.role,
    className: u.class?.name ?? null,
  }));
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <LoginForm users={list} />
    </main>
  );
}
