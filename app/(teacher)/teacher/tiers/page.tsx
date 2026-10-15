"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, ArrowUpDown, Loader2, Lock, Unlock } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TierBadge } from "@/components/app/tier-badge";
import { TIER_META, type Tier } from "@/lib/mastery";
import { formatStudent, pct } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface TierCandidate {
  studentId: string;
  name: string;
  studentNo: string | null;
  currentTier: Tier;
  autoTier: Tier;
  suggestedTier: Tier;
  direction: "up" | "down";
  pinned: boolean;
  avg: number;
  trendDelta: number | null;
  weakKps: { code: string; name: string; avg: number }[];
  errorTags: { tag: string; count: number }[];
  advice: { summary: string; reasons: string[] };
}
interface PinnedStudent {
  id: string;
  name: string;
  studentNo: string | null;
  tierOverride: string | null;
}

export default function TiersPage() {
  const [subjects, setSubjects] = useState<{ id: string; code: string; name: string }[]>([]);
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [subject, setSubject] = useState("math");
  const [classId, setClassId] = useState("");
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<TierCandidate[]>([]);
  const [pinned, setPinned] = useState<PinnedStudent[]>([]);
  const [aiGenerated, setAiGenerated] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    fetch("/api/subjects")
      .then((r) => r.json())
      .then((s) => {
        const list = Array.isArray(s) ? s : [];
        setSubjects(list);
        if (list.length) setSubject(list[0].code);
      })
      .catch(() => {});
    fetch("/api/classes")
      .then((r) => r.json())
      .then((c) => {
        const list = Array.isArray(c) ? c : [];
        setClasses(list);
        if (list.length) setClassId(list[0].id);
      })
      .catch(() => {});
  }, []);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(`/api/teacher/tiers?subject=${subject}&classId=${classId}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "加载失败");
      setItems(Array.isArray(j.items) ? j.items : []);
      setPinned(Array.isArray(j.pinned) ? j.pinned : []);
      setAiGenerated(Boolean(j.aiGenerated));
      setSelected(new Set());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }

  async function apply(items: { studentId: string; tier: Tier | null }[], successMsg: string) {
    setApplying(true);
    try {
      const r = await fetch("/api/teacher/tiers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "操作失败");
      toast.success(successMsg);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作失败");
    } finally {
      setApplying(false);
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const subjectName = subjects.find((s) => s.code === subject)?.name ?? subject;
  const adoptList = useMemo(
    () => items.filter((i) => selected.has(i.studentId)),
    [items, selected]
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowUpDown className="h-5 w-5" />
            分层升降建议
          </CardTitle>
          <CardDescription>
            系统按掌握度、近 7 天趋势与错因给出升降层候选；采纳后分层将被锁定，清除锁定后恢复自动计算。建议仅供教学决策参考。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>科目</Label>
              <Select value={subject} onValueChange={setSubject}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {subjects.map((s) => (
                    <SelectItem key={s.code} value={s.code}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>班级</Label>
              <Select value={classId} onValueChange={setClassId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {classes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button onClick={load} disabled={loading || !classId}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {loading ? "分析中…" : "生成建议"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {items.length === 0 && !loading && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {pinned.length
              ? "当前没有分层与实际掌握度不一致的学生。"
              : `当前没有候选（${subjectName} 的分层与掌握度一致）。`}
          </CardContent>
        </Card>
      )}

      {items.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              <span>候选名单（{items.length} 人）</span>
              <Badge variant="outline">{aiGenerated ? "AI 生成理由" : "模板生成理由（未配置 AI Key）"}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {items.map((c) => (
              <div
                key={c.studentId}
                className="flex flex-wrap items-start gap-3 rounded-lg border p-3"
              >
                <input
                  type="checkbox"
                  checked={selected.has(c.studentId)}
                  onChange={() => toggle(c.studentId)}
                  aria-label={`选择 ${formatStudent(c.name, c.studentNo)}`}
                  className="mt-1 h-4 w-4 accent-primary"
                />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{formatStudent(c.name, c.studentNo)}</span>
                    <TierBadge tier={c.currentTier} />
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                    <TierBadge tier={c.suggestedTier} />
                    {c.pinned && (
                      <Badge variant="secondary">
                        <Lock className="mr-1 h-3 w-3" />
                        已锁定
                      </Badge>
                    )}
                    <span className="text-sm text-muted-foreground">
                      平均掌握度 {pct(c.avg)}
                    </span>
                    {c.trendDelta !== null && (
                      <span
                        className={`text-sm tabular-nums ${
                          c.trendDelta >= 0 ? "text-emerald-600" : "text-red-500"
                        }`}
                      >
                        近7天 {c.trendDelta >= 0 ? "+" : ""}
                        {Math.round(c.trendDelta * 100)}pp
                      </span>
                    )}
                  </div>
                  {c.weakKps.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {c.weakKps.map((k) => (
                        <Badge key={k.code} variant="outline">
                          薄弱 {k.code} {k.name}（{pct(k.avg)}）
                        </Badge>
                      ))}
                    </div>
                  )}
                  {c.errorTags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {c.errorTags.map((t) => (
                        <Badge key={t.tag} variant="outline">
                          {t.tag} ×{t.count}
                        </Badge>
                      ))}
                    </div>
                  )}
                  <div className="text-sm">
                    <p className="font-medium">{c.advice.summary}</p>
                    <ul className="list-inside list-disc text-muted-foreground">
                      {c.advice.reasons.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between pt-2">
              <span className="text-sm text-muted-foreground">
                已勾选 {adoptList.length} 人
              </span>
              <Button
                disabled={!adoptList.length || applying}
                onClick={() =>
                  apply(
                    adoptList.map((c) => ({ studentId: c.studentId, tier: c.suggestedTier })),
                    `已采纳 ${adoptList.length} 名学生的分层调整`
                  )
                }
              >
                {applying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                一键采纳选中
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {pinned.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">已锁定分层（{pinned.length} 人）</CardTitle>
            <CardDescription>锁定期间不随掌握度自动升降；清除后恢复自动计算。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {pinned.map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium">{formatStudent(p.name, p.studentNo)}</span>
                  {p.tierOverride && (
                    <TierBadge tier={p.tierOverride as Tier} />
                  )}
                  <Badge variant="secondary">
                    <Lock className="mr-1 h-3 w-3" />
                    已锁定
                  </Badge>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={applying}
                  onClick={() => apply([{ studentId: p.id, tier: null }], `已清除 ${formatStudent(p.name, p.studentNo)} 的分层锁定`)}
                >
                  <Unlock className="mr-1.5 h-3.5 w-3.5" />
                  清除锁定
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        分层说明：{TIER_META.foundation.label}（掌握度 &lt; 50%）、{TIER_META.intermediate.label}（50%–80%）、{TIER_META.advanced.label}（≥ 80%）。分层用于作业分层分发与教学分组，可流动、可申诉。
      </p>
    </div>
  );
}
