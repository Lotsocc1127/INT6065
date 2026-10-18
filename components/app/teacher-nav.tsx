"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { ArrowLeft, ArrowUpDown, BookOpen, ClipboardCheck, ClipboardList, FilePlus2, FileText, Sparkles, Users2, type LucideIcon } from "lucide-react";
import { BrandLogo } from "@/components/app/brand-logo";
import { GovernanceModal } from "@/components/app/governance-modal";
import { SettingsMenu } from "@/components/app/settings-menu";
import { NotificationBell } from "@/components/app/notification-bell";
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
      <div className="mx-auto max-w-7xl px-4 md:px-6">
        {/* 第一行：品牌 + 右侧操作（学生端同款结构） */}
        <div className="flex h-12 items-center justify-between gap-3">
          <Link href="/teacher" className="flex shrink-0 items-center gap-2">
            <BrandLogo size={28} />
            <span className="text-lg font-bold tracking-tight">智学慧教</span>
            <span className="rounded bg-primary px-1.5 py-0.5 text-xs text-primary-foreground">
              教师端
            </span>
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            {isAdmin ? (
              <Link
                href="/admin"
                className="flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent"
              >
                <ArrowLeft className="h-4 w-4 shrink-0" />
                返回管理端
              </Link>
            ) : null}
            <GovernanceModal />
            <SettingsMenu />
            <NotificationBell />
            <UserNav />
          </div>
        </div>
        {/* 第二行：导航横向铺开（全宽均分，窄屏横向滚动） */}
        <nav className="flex items-center gap-1 overflow-x-auto pb-2">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent max-sm:flex-none",
                pathname === l.href
                  ? "bg-accent font-medium text-accent-foreground"
                  : "text-muted-foreground"
              )}
            >
              <span className="inline-flex items-center gap-1.5">
                <l.icon className="h-4 w-4 shrink-0" />
                {l.label}
              </span>
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
