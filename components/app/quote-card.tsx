import { Quote } from "lucide-react";
import { cn } from "@/lib/utils";

/** 每日名言（按日期轮换，一天一条） */
const QUOTES: { text: string; author: string }[] = [
  { text: "学而不思则罔，思而不学则殆。", author: "《论语》" },
  { text: "知之者不如好之者，好之者不如乐之者。", author: "《论语》" },
  { text: "不积跬步，无以至千里；不积小流，无以成江海。", author: "荀子《劝学》" },
  { text: "业精于勤，荒于嬉；行成于思，毁于随。", author: "韩愈《进学解》" },
  { text: "博学之，审问之，慎思之，明辨之，笃行之。", author: "《礼记·中庸》" },
  { text: "少年易老学难成，一寸光阴不可轻。", author: "朱熹" },
  { text: "读书破万卷，下笔如有神。", author: "杜甫" },
  { text: "纸上得来终觉浅，绝知此事要躬行。", author: "陆游" },
  { text: "教育不是灌输，而是点燃火焰。", author: "苏格拉底" },
  { text: "教育的根是苦的，但其果实是甜的。", author: "亚里士多德" },
  { text: "学习最好的方式，就是把它教给别人。", author: "费曼" },
  { text: "每个孩子都是一颗种子，只是花期不同。", author: "佚名" },
];

export function QuoteCard({ className }: { className?: string }) {
  // 按天轮换（同一天内保持一致）
  const dayIndex = Math.floor(Date.now() / 86_400_000);
  const q = QUOTES[dayIndex % QUOTES.length];
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-lg border border-dashed px-4 py-3 text-sm",
        className
      )}
    >
      <Quote className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-foreground">{q.text}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">—— {q.author}</p>
      </div>
    </div>
  );
}
