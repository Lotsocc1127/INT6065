"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GraduationCap } from "lucide-react";
import { GovernanceModal } from "@/components/app/governance-modal";
import { UserNav } from "@/components/app/user-nav";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/teacher", label: "班级看板" },
  { href: "/teacher/assignments", label: "作业管理" },
  { href: "/teacher/assignments/new", label: "布置作业" },
  { href: "/teacher/prep", label: "AI 备课" },
  { href: "/teacher/students", label: "学生管理" },
];

export function TeacherNav() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 md:px-6">
        <div className="flex items-center gap-6">
          <Link href="/teacher" className="flex items-center gap-2 font-semibold">
            <GraduationCap className="h-5 w-5" />
            智学慧教
            <span className="hidden rounded bg-primary px-1.5 py-0.5 text-xs text-primary-foreground md:inline">
              教师端
            </span>
          </Link>
          <nav className="flex items-center gap-1">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-accent",
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
        <div className="flex items-center gap-2">
          <GovernanceModal />
          <UserNav />
        </div>
      </div>
    </header>
  );
}
