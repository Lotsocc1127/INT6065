"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GraduationCap } from "lucide-react";
import { GovernanceModal } from "@/components/app/governance-modal";
import { UserNav } from "@/components/app/user-nav";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/student", label: "任务中心" },
  { href: "/student/map", label: "知识图谱" },
  { href: "/student/path", label: "学习路径" },
  { href: "/student/socrates", label: "苏格拉底辅导" },
  { href: "/student/wrong", label: "错题本" },
  { href: "/student/growth", label: "成长档案" },
  { href: "/student/goals", label: "目标" },
];

export function StudentNav() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4 md:px-6">
        <div className="flex min-w-0 items-center gap-4">
          <Link href="/student" className="flex shrink-0 items-center gap-2 font-semibold">
            <GraduationCap className="h-5 w-5" />
            <span className="hidden md:inline">AI 学生成长系统</span>
            <span className="rounded bg-primary px-1.5 py-0.5 text-xs text-primary-foreground">学生端</span>
          </Link>
          <nav className="flex items-center gap-0.5 overflow-x-auto">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={cn(
                  "whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm transition-colors hover:bg-accent",
                  pathname === l.href
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-muted-foreground"
                )}
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <GovernanceModal />
          <UserNav />
        </div>
      </div>
    </header>
  );
}
