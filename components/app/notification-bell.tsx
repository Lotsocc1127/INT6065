"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { fmtDateTime } from "@/lib/utils";

interface NotiItem {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

/** 站内通知铃铛（学生端/教师端通用）：未读数随路由切换刷新；打开面板时拉全量列表 */
export function NotificationBell() {
  const pathname = usePathname();
  const router = useRouter();
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<NotiItem[]>([]);

  useEffect(() => {
    fetch("/api/notifications?countOnly=1")
      .then((r) => r.json())
      .then((j) => setCount(Number(j.count) || 0))
      .catch(() => {});
  }, [pathname]);

  const loadItems = () => {
    fetch("/api/notifications")
      .then((r) => r.json())
      .then((j) => {
        if (Array.isArray(j.items)) setItems(j.items);
      })
      .catch(() => {});
  };

  const markRead = async (ids?: string[]) => {
    await fetch("/api/notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ids ? { ids } : {}),
    }).catch(() => {});
  };

  const onItemClick = async (it: NotiItem) => {
    if (!it.readAt) {
      await markRead([it.id]);
      setItems((prev) =>
        prev.map((p) => (p.id === it.id ? { ...p, readAt: new Date().toISOString() } : p))
      );
      setCount((c) => Math.max(0, c - 1));
    }
    if (it.link) router.push(it.link);
  };

  const onMarkAll = async () => {
    await markRead();
    setItems((prev) =>
      prev.map((p) => ({ ...p, readAt: p.readAt ?? new Date().toISOString() }))
    );
    setCount(0);
  };

  return (
    <DropdownMenu onOpenChange={(open) => open && loadItems()}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="通知">
          <Bell className="h-4 w-4" />
          {count > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white">
              {count > 99 ? "99+" : count}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-80 p-0" align="end">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">通知</span>
          {items.some((i) => !i.readAt) ? (
            <button
              className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              onClick={onMarkAll}
            >
              <CheckCheck className="h-3.5 w-3.5" />
              全部已读
            </button>
          ) : null}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {items.length ? (
            items.map((it) => (
              <DropdownMenuItem
                key={it.id}
                onSelect={() => onItemClick(it)}
                className="flex cursor-pointer flex-col items-start gap-0.5 border-b px-3 py-2.5 last:border-b-0"
              >
                <span className="flex w-full items-center gap-1.5">
                  {!it.readAt ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" /> : null}
                  <span className="text-sm font-medium">{it.title}</span>
                </span>
                <span className="line-clamp-2 text-xs text-muted-foreground">{it.body}</span>
                <span className="text-[10px] text-muted-foreground">{fmtDateTime(it.createdAt)}</span>
              </DropdownMenuItem>
            ))
          ) : (
            <DropdownMenuLabel className="py-6 text-center">暂无通知</DropdownMenuLabel>
          )}
        </div>
        <DropdownMenuSeparator className="m-0" />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
