"use client";

import { signOut, useSession } from "next-auth/react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function UserNav() {
  const { data: session } = useSession();
  if (!session?.user) return null;
  return (
    <div className="flex items-center gap-2">
      <Badge variant="secondary" className="hidden sm:inline-flex">
        {session.user.role === "STUDENT" ? "学生" : "教师"}
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
