"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { GraduationCap, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { SubjectSwitcher, type SubjectInfo } from "@/components/app/subject-switcher";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface KpInfo {
  id: string;
  code: string;
  name: string;
}
interface Msg {
  role: "user" | "assistant";
  content: string;
}

const WELCOME: Msg = {
  role: "assistant",
  content:
    "你好！我是你的苏格拉底式辅导老师 😊 我不会直接告诉你答案，而是通过提问帮你自己想通。\n\n先说说：你现在想学哪个知识点？遇到了哪道题或哪个困惑？",
};

function SocratesChat() {
  const searchParams = useSearchParams();
  const kpFromUrl = searchParams.get("kp") ?? "";
  const subject = searchParams.get("subject") ?? "math";
  const [subjects, setSubjects] = useState<SubjectInfo[]>([]);
  const [kps, setKps] = useState<KpInfo[]>([]);
  const [kpCode, setKpCode] = useState(kpFromUrl);
  const [messages, setMessages] = useState<Msg[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [llmReady, setLlmReady] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/subjects")
      .then((r) => r.json())
      .then((s) => setSubjects(Array.isArray(s) ? s : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch(`/api/subjects/${subject}/knowledge-points`)
      .then((r) => r.json())
      .then((k) => setKps(Array.isArray(k) ? k : []))
      .catch(() => {});
  }, [subject]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || loading) return;
    const next: Msg[] = [...messages, { role: "user", content }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const r = await fetch("/api/ai/socrates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next.map((m) => ({ role: m.role, content: m.content })),
          ...(kpCode ? { kpCode } : {}),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "请求失败");
      setMessages((prev) => [...prev, { role: "assistant", content: j.reply }]);
      setLlmReady(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "请求失败";
      setLlmReady(false);
      toast.error(msg);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `⚠️ 辅导服务暂时不可用：${msg}。请稍后重试或联系老师。`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <SubjectSwitcher subjects={subjects} current={subject} />
      <Card className="flex h-[calc(100vh-13rem)] flex-col">
        <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2">
          <GraduationCap className="h-5 w-5" />
          苏格拉底式辅导
        </CardTitle>
        <CardDescription>
          铁律：我绝不直接给答案——只通过提问帮你自己找到思路。
        </CardDescription>
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="text-xs text-muted-foreground">当前知识点：</span>
          <Badge
            variant={kpCode ? "default" : "outline"}
            className="cursor-pointer"
            onClick={() => setKpCode("")}
          >
            {kpCode ? kps.find((k) => k.code === kpCode)?.name ?? kpCode : "不限"}
          </Badge>
          {kps
            .filter((k) => k.code !== kpCode)
            .map((k) => (
              <Badge
                key={k.id}
                variant="outline"
                className="cursor-pointer"
                onClick={() => setKpCode(k.code)}
              >
                {k.name}
              </Badge>
            ))}
        </div>
      </CardHeader>
      <CardContent className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((m, i) => (
          <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                m.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted"
              )}
            >
              {m.content}
            </div>
          </div>
        ))}
        {loading ? (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-2xl bg-muted px-4 py-2.5 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              老师正在思考怎么引导你…
            </div>
          </div>
        ) : null}
        <div ref={bottomRef} />
      </CardContent>
      <div className="border-t p-3">
        {!llmReady ? (
          <p className="mb-2 text-xs text-destructive">
            未检测到可用的 LLM API Key：请在 .env 中配置（如 DEEPSEEK_API_KEY）后重启服务。
          </p>
        ) : null}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="描述你的困惑，或粘贴题目…（Enter 发送，Shift+Enter 换行）"
            rows={2}
            className="resize-none"
          />
          <Button type="submit" size="icon" aria-label="发送" disabled={loading || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
      </Card>
    </div>
  );
}

export default function SocratesPage() {
  return (
    <Suspense>
      <SocratesChat />
    </Suspense>
  );
}
