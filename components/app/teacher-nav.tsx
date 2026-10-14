"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { ArrowLeft, ArrowUpDown, BookOpen, ClipboardCheck, ClipboardList, FilePlus2, FileText, Sparkles, Users2, type LucideIcon } from "lucide-react";
import { BrandLogo } from "@/components/app/brand-logo";
import { GovernanceModal } from "@/components/app/governance-modal";
import { SettingsMenu } from "@/components/app/settings-menu";
import { UserNav } from "@/components/app/user-nav";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const LINKS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/teacher", label: "班级看板", icon: BookOpen },
  { href: "/teacher/assignments", label: "作业管理", icon: ClipboardList },
  { href: "/teacher/review", label: "待复核", icon: ClipboardCheck },
  { href: "/teacher/assignments/new", label: "布置作业", icon: FilePlus2 },
  { href: "/teacher/prep", label: "AI 备课", icon: Sparkles },
  { href: "/teacher/tiers", label: "分层升降", icon: ArrowUpDown },
  { href: "/teacher/weekly-report", label: "AI 周报", icon: FileText },
  { href: "/teacher/students", label: "学生管理", icon: Users2 },
];

export function TeacherNav() {
  const pathname = usePathname();
  // 管理员也会进 /teacher 预览（见 app/(teacher)/teacher/layout.tsx），需给他一条回管理端的路
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "ADMIN";
  // 待复核数量徽章 = 作业待复核 + 目标申诉（两个队列在 /teacher/review 同页展示）
  const [reviewCount, setReviewCount] = useState(0);
  useEffect(() => {
    Promise.all([
      fetch("/api/review-queue?countOnly=1").then((r) => r.json()).catch(() => ({})),
      fetch("/api/teacher/appeals?countOnly=1").then((r) => r.json()).catch(() => ({})),
    ]).then(([a, b]) =>
      setReviewCount((Number(a.count) || 0) + (Number(b.count) || 0))
    );
  }, [pathname]);
  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2 md:h-14 md:flex-nowrap md:px-6 md:py-0">
        <Link href="/teacher" className="order-1 flex shrink-0 items-center gap-2">
          <BrandLogo size={30} />
          <span className="text-lg font-bold tracking-tight">智学慧教</span>
          <span className="hidden rounded bg-primary px-1.5 py-0.5 text-xs text-primary-foreground md:inline">
            教师端
          </span>
        </Link>
        <div className="order-2 flex shrink-0 items-center gap-2 md:order-3">
          <GovernanceModal />
          <SettingsMenu />
          <UserNav />
        </div>
        {/* 手机：整行独立第二行横向滚动；桌面：中间单行 */}
        <nav className="order-3 flex w-full basis-full items-center gap-0.5 overflow-x-auto md:order-2 md:min-w-0 md:w-auto md:flex-1 md:basis-auto">
          {isAdmin ? (
            <Link
              href="/admin"
              className="flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent"
            >
              <ArrowLeft className="h-4 w-4 shrink-0" />
              返回管理端
            </Link>
          ) : null}
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                "flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm transition-colors hover:bg-accent",
                pathname === l.href
                  ? "bg-accent font-medium text-accent-foreground"
                  : "text-muted-foreground"
              )}
            >
              <l.icon className="h-4 w-4 shrink-0" />
              {l.label}
              {l.href === "/teacher/review" && reviewCount > 0 ? (
                <Badge
                  variant="secondary"
                  className="ml-0.5 h-4 min-w-4 justify-center px-1 text-[10px]"
                >
                  {reviewCount}
                </Badge>
              ) : null}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
