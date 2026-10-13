import { Inbox, type LucideIcon } from "lucide-react";

/** 空状态占位：图标 + 标题 + 可选的引导文案 */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  hint,
}: {
  icon?: LucideIcon;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <Icon className="h-10 w-10 text-muted-foreground/40" />
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      {hint ? <p className="max-w-sm text-xs text-muted-foreground/80">{hint}</p> : null}
    </div>
  );
}
