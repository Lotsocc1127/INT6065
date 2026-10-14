import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";

export default async function Home() {
  const session = await getServerSession(authOptions);
  if (session?.user) {
    // 管理员应回到管理端；否则管理员访问 / 会被送到 /teacher，而教师端没有返回入口
    if (session.user.role === "ADMIN") redirect("/admin");
    redirect(session.user.role === "STUDENT" ? "/student" : "/teacher");
  }
  redirect("/login");
}
