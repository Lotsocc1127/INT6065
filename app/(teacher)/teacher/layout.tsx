import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { TeacherNav } from "@/components/app/teacher-nav";

export default async function TeacherLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !["TEACHER", "ADMIN"].includes(session.user.role)) {
    redirect("/login");
  }
  return (
    <div className="min-h-screen bg-muted/30">
      <TeacherNav />
      <main className="mx-auto max-w-7xl p-4 md:p-6">{children}</main>
    </div>
  );
}
