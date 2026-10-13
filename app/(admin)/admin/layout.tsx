import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { BookOpen, ShieldCheck } from "lucide-react";
import { authOptions } from "@/lib/auth";
import { BrandLogo } from "@/components/app/brand-logo";
import { PageTransition } from "@/components/app/page-transition";
import { SettingsMenu } from "@/components/app/settings-menu";
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
          <div className="flex min-w-0 items-center gap-4">
            <Link href="/admin" className="flex shrink-0 items-center gap-2">
              <BrandLogo size={30} />
              <span className="text-lg font-bold tracking-tight">智学慧教</span>
              <span className="hidden rounded bg-primary px-1.5 py-0.5 text-xs text-primary-foreground md:inline">
                管理端
              </span>
            </Link>
            <nav className="flex items-center gap-1 overflow-x-auto">
              <Link
                href="/admin"
                className="flex items-center gap-1.5 whitespace-nowrap rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground"
              >
                <ShieldCheck className="h-4 w-4 shrink-0" />
                账号管理
              </Link>
              <Link
                href="/teacher"
                className="flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent"
              >
                <BookOpen className="h-4 w-4 shrink-0" />
                教师端看板
              </Link>
            </nav>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <SettingsMenu />
            <UserNav />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl p-4 md:p-6">
        <PageTransition>{children}</PageTransition>
      </main>
      <footer className="mx-auto max-w-7xl px-4 pb-4 text-center text-xs text-muted-foreground">
        智学慧教 · 制作组 Six gods
      </footer>
    </div>
  );
}
