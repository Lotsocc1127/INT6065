"use client";

import { signOut, useSession } from "next-auth/react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const ROLE_LABEL: Record<string, string> = {
  STUDENT: "学生",
  TEACHER: "教师",
  ADMIN: "管理员",
  PARENT: "家长",
};

export function UserNav() {
  const { data: session } = useSession();
  if (!session?.user) return null;
  return (
    <div className="flex items-center gap-2">
      <Badge variant="secondary" className="hidden sm:inline-flex">
        {ROLE_LABEL[session.user.role] ?? session.user.role}
      </Badge>
      <span className="text-sm text-muted-foreground">{session.user.name}</span>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => signOut({ callbackUrl: "/login" })}
        className="gap-1"
      >
        <LogOut className="h-4 w-4" />
        退出
      </Button>
    </div>
  );
}
