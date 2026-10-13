"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, ClipboardList, FilePlus2, Sparkles, Users2, type LucideIcon } from "lucide-react";
import { BrandLogo } from "@/components/app/brand-logo";
import { GovernanceModal } from "@/components/app/governance-modal";
import { SettingsMenu } from "@/components/app/settings-menu";
import { UserNav } from "@/components/app/user-nav";
import { cn } from "@/lib/utils";

const LINKS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/teacher", label: "班级看板", icon: BookOpen },
  { href: "/teacher/assignments", label: "作业管理", icon: ClipboardList },
  { href: "/teacher/assignments/new", label: "布置作业", icon: FilePlus2 },
  { href: "/teacher/prep", label: "AI 备课", icon: Sparkles },
  { href: "/teacher/students", label: "学生管理", icon: Users2 },
];

export function TeacherNav() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 md:px-6">
        <div className="flex min-w-0 items-center gap-4">
          <Link href="/teacher" className="flex shrink-0 items-center gap-2">
            <BrandLogo size={30} />
            <span className="text-lg font-bold tracking-tight">智学慧教</span>
            <span className="hidden rounded bg-primary px-1.5 py-0.5 text-xs text-primary-foreground md:inline">
              教师端
            </span>
          </Link>
          <nav className="flex items-center gap-0.5 overflow-x-auto">
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
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <GovernanceModal />
          <SettingsMenu />
          <UserNav />
        </div>
      </div>
    </header>
  );
}
