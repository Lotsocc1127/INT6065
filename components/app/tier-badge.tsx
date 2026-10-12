import { TIER_META, type Tier } from "@/lib/mastery";
import { cn } from "@/lib/utils";

/** 分层徽章：序数色阶（蓝色 100→400），文字承载含义 */
const TIER_STYLE: Record<Tier, string> = {
  foundation: "bg-[#cde2fb] text-[#104281] border-[#9ec5f4]",
  intermediate: "bg-[#6da7ec] text-[#0d366b] border-[#5598e7]",
  advanced: "bg-[#2a78d6] text-white border-[#256abf]",
};

export function TierBadge({ tier, className }: { tier: Tier; className?: string }) {
  const meta = TIER_META[tier];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
        TIER_STYLE[tier],
        className
      )}
    >
      {meta.label}
    </span>
  );
}

export function TierLegend() {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">分层：</span>
      {(Object.keys(TIER_META) as Tier[]).map((t) => (
        <span key={t} className="flex items-center gap-1.5">
          <TierBadge tier={t} />
          <span>{TIER_META[t].desc}</span>
        </span>
      ))}
    </div>
  );
}
