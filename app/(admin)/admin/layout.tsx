import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { authOptions } from "@/lib/auth";
import { UserNav } from "@/components/app/user-nav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") {
    redirect("/login");
  }
  return (
    <div className="min-h-screen bg-muted/30">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 md:px-6">
          <div className="flex items-center gap-6">
            <Link href="/admin" className="flex items-center gap-2 font-semibold">
              <ShieldCheck className="h-5 w-5" />
              智学慧教
              <span className="hidden rounded bg-primary px-1.5 py-0.5 text-xs text-primary-foreground md:inline">
                管理端
              </span>
            </Link>
            <nav className="flex items-center gap-1">
              <Link
                href="/admin"
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground"
              >
                账号管理
              </Link>
              <Link
                href="/teacher"
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent"
              >
                教师端看板
              </Link>
            </nav>
          </div>
          <UserNav />
        </div>
      </header>
      <main className="mx-auto max-w-7xl p-4 md:p-6">{children}</main>
    </div>
  );
}
