import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { PageTransition } from "@/components/app/page-transition";
import { StudentNav } from "@/components/app/student-nav";

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "STUDENT") {
    redirect("/login");
  }
  return (
    <div className="min-h-screen bg-muted/30">
      <StudentNav />
      <main className="mx-auto max-w-7xl p-4 md:p-6">
        <PageTransition>{children}</PageTransition>
      </main>
      <footer className="mx-auto max-w-7xl px-4 pb-4 text-center text-xs text-muted-foreground">
        智学慧教 · 制作组 Six gods
      </footer>
    </div>
  );
}
