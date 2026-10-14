/** AI 判分置信度徽章：≥0.9 绿 / ≥0.7 蓝 / <0.7 琥珀 */
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function ConfidenceBadge({ confidence, className }: { confidence: number; className?: string }) {
  const tone =
    confidence >= 0.9
      ? "bg-emerald-100 text-emerald-700"
      : confidence >= 0.7
        ? "bg-blue-100 text-blue-700"
        : "bg-amber-100 text-amber-800";
  return (
    <Badge className={cn("gap-1", tone, className)} title="AI 判分置信度">
      置信度 {Math.round(confidence * 100)}%
    </Badge>
  );
}
