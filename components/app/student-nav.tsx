"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookX,
  ClipboardCheck,
  MessageCircleQuestion,
  Network,
  Route,
  Target,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { BrandLogo } from "@/components/app/brand-logo";
import { GovernanceModal } from "@/components/app/governance-modal";
import { SettingsMenu } from "@/components/app/settings-menu";
import { NotificationBell } from "@/components/app/notification-bell";
import { UserNav } from "@/components/app/user-nav";
import { cn } from "@/lib/utils";

const LINKS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/student", label: "任务中心", icon: ClipboardCheck },
  { href: "/student/map", label: "知识图谱", icon: Network },
  { href: "/student/path", label: "学习路径", icon: Route },
  { href: "/student/socrates", label: "苏格拉底辅导", icon: MessageCircleQuestion },
  { href: "/student/wrong", label: "错题本", icon: BookX },
  { href: "/student/growth", label: "成长档案", icon: TrendingUp },
  { href: "/student/goals", label: "目标", icon: Target },
];

export function StudentNav() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto max-w-7xl px-4 md:px-6">
        {/* 第一行：品牌 + 右侧操作 */}
        <div className="flex h-12 items-center justify-between gap-3">
          <Link href="/student" className="flex shrink-0 items-center gap-2">
            <BrandLogo size={28} />
            <span className="text-lg font-bold tracking-tight">智学慧教</span>
            <span className="rounded bg-primary px-1.5 py-0.5 text-xs text-primary-foreground">
              学生端
            </span>
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            <GovernanceModal />
            <SettingsMenu />
            <NotificationBell />
            <UserNav />
          </div>
        </div>
        {/* 第二行：导航横向铺开 */}
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
              <l.icon className="h-4 w-4 shrink-0" />
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
