"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Plus, School, Trash2, UserCog } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

interface TeacherRow {
  id: string;
  name: string;
  headTeacherClassId: string | null;
  headTeacherClassName: string | null;
  subjectId: string | null;
  subjectCode: string | null;
  subjectName: string | null;
}
interface ClassRow {
  id: string;
  name: string;
  studentCount: number;
}
interface SubjectRow {
  id: string;
  code: string;
  name: string;
}

const NONE = "none"; // Select 哨兵值：不绑定

export default function AdminPage() {
  const [teachers, setTeachers] = useState<TeacherRow[] | null>(null);
  const [classes, setClasses] = useState<ClassRow[] | null>(null);
  const [subjects, setSubjects] = useState<SubjectRow[] | null>(null);
  // 添加教师
  const [tName, setTName] = useState("");
  const [tPassword, setTPassword] = useState("");
  const [tClassId, setTClassId] = useState(NONE);
  const [tSubjectId, setTSubjectId] = useState(NONE);
  const [adding, setAdding] = useState(false);
  // 重置教师密码
  const [resetTarget, setResetTarget] = useState<TeacherRow | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetting, setResetting] = useState(false);
  // 设置教师绑定（班主任/科目教师）
  const [bindTarget, setBindTarget] = useState<TeacherRow | null>(null);
  const [bindClassId, setBindClassId] = useState(NONE);
  const [bindSubjectId, setBindSubjectId] = useState(NONE);
  const [binding, setBinding] = useState(false);
  // 删除教师
  const [deleteTarget, setDeleteTarget] = useState<TeacherRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  // 新建班级
  const [cName, setCName] = useState("");
  const [creating, setCreating] = useState(false);

  const loadTeachers = useCallback(async () => {
    fetch("/api/admin/teachers")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "加载失败");
        setTeachers(Array.isArray(j) ? j : []);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "加载失败"));
  }, []);

  const loadClasses = useCallback(async () => {
    fetch("/api/classes")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "加载失败");
        setClasses(Array.isArray(j) ? j : []);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "加载失败"));
  }, []);

  const loadSubjects = useCallback(async () => {
    fetch("/api/subjects")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "加载失败");
        setSubjects(Array.isArray(j) ? j : []);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "加载失败"));
  }, []);

  useEffect(() => {
    void loadTeachers();
    void loadClasses();
    void loadSubjects();
  }, [loadTeachers, loadClasses, loadSubjects]);

  async function addTeacher() {
    if (!tName.trim()) {
      toast.error("请填写教师姓名");
      return;
    }
    setAdding(true);
    try {
      const r = await fetch("/api/admin/teachers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: tName.trim(),
          password: tPassword.trim() || undefined,
          classId: tClassId !== NONE ? tClassId : null,
          subjectId: tSubjectId !== NONE ? tSubjectId : null,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "添加失败");
      toast.success(`已添加教师 ${tName.trim()}`);
      setTName("");
      setTPassword("");
      setTClassId(NONE);
      setTSubjectId(NONE);
      void loadTeachers();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "添加失败");
    } finally {
      setAdding(false);
    }
  }

  async function doResetPassword() {
    if (!resetTarget) return;
    if (resetPassword.trim().length < 4 || resetPassword.trim().length > 32) {
      toast.error("密码需 4–32 位");
      return;
    }
    setResetting(true);
    try {
      const r = await fetch(`/api/admin/teachers/${resetTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: resetPassword.trim() }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "重置失败");
      toast.success(`已重置 ${resetTarget.name} 的密码`);
      setResetTarget(null);
      setResetPassword("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "重置失败");
    } finally {
      setResetting(false);
    }
  }

  async function doSaveBinding() {
    if (!bindTarget) return;
    setBinding(true);
    try {
      const r = await fetch(`/api/admin/teachers/${bindTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: bindClassId !== NONE ? bindClassId : null,
          subjectId: bindSubjectId !== NONE ? bindSubjectId : null,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "保存失败");
      toast.success(`已更新 ${bindTarget.name} 的绑定（下次登录生效）`);
      setBindTarget(null);
      void loadTeachers();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBinding(false);
    }
  }

  async function deleteTeacher() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const r = await fetch(`/api/admin/teachers/${deleteTarget.id}`, { method: "DELETE" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "删除失败");
      toast.success(`已删除教师 ${deleteTarget.name}`);
      setDeleteTarget(null);
      void loadTeachers();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除失败");
    } finally {
      setDeleting(false);
    }
  }

  async function createClass() {
    if (!cName.trim()) {
      toast.error("请填写班级名称");
      return;
    }
    setCreating(true);
    try {
      const r = await fetch("/api/admin/classes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: cName.trim() }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "创建失败");
      toast.success(`已创建班级 ${cName.trim()}`);
      setCName("");
      void loadClasses();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "创建失败");
    } finally {
      setCreating(false);
    }
  }

  function bindingBadge(t: TeacherRow) {
    if (t.headTeacherClassId) {
      return <Badge>班主任 · {t.headTeacherClassName}</Badge>;
    }
    if (t.subjectId) {
      return <Badge variant="secondary">科目教师 · {t.subjectName}</Badge>;
    }
    return <Badge variant="outline">未绑定（全量权限）</Badge>;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserCog className="h-5 w-5" />
            教师账号管理
          </CardTitle>
          <CardDescription>
            创建教师账号、重置教师密码、设置教师绑定（班主任只可见本班；科目教师只可见本学科；未绑定为全量权限）。绑定修改后该教师重新登录生效。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="teacher-name">教师姓名</Label>
            <Input
              id="teacher-name"
              value={tName}
              onChange={(e) => setTName(e.target.value)}
              placeholder="如：李老师"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="teacher-password">初始密码（留空则 123456，4–32 位）</Label>
            <Input
              id="teacher-password"
              type="password"
              value={tPassword}
              maxLength={32}
              onChange={(e) => setTPassword(e.target.value)}
              placeholder="默认 123456"
            />
          </div>
          <div className="space-y-2">
            <Label>绑定班级（班主任）</Label>
            <Select
              value={tClassId}
              onValueChange={(v) => {
                setTClassId(v);
                if (v !== NONE) setTSubjectId(NONE);
              }}
            >
              <SelectTrigger aria-label="绑定班级">
                <SelectValue placeholder="选择班级" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>无（全量权限）</SelectItem>
                {(classes ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>绑定科目（科目教师）</Label>
            <Select
              value={tSubjectId}
              onValueChange={(v) => {
                setTSubjectId(v);
                if (v !== NONE) setTClassId(NONE);
              }}
            >
              <SelectTrigger aria-label="绑定科目">
                <SelectValue placeholder="选择科目" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>无（全量权限）</SelectItem>
                {(subjects ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end md:col-span-1">
            <Button onClick={addTeacher} disabled={adding} className="gap-1">
              <Plus className="h-4 w-4" />
              {adding ? "添加中…" : "添加教师"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">教师列表</CardTitle>
        </CardHeader>
        <CardContent>
          {!teachers ? <Skeleton className="h-32" /> : null}
          {teachers ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>姓名</TableHead>
                  <TableHead>绑定</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {teachers.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell>{bindingBadge(t)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1"
                          onClick={() => {
                            setBindTarget(t);
                            setBindClassId(t.headTeacherClassId ?? NONE);
                            setBindSubjectId(t.subjectId ?? NONE);
                          }}
                        >
                          <UserCog className="h-3.5 w-3.5" />
                          设置绑定
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1"
                          onClick={() => {
                            setResetTarget(t);
                            setResetPassword("");
                          }}
                        >
                          <KeyRound className="h-3.5 w-3.5" />
                          重置密码
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1 text-destructive"
                          onClick={() => setDeleteTarget(t)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          删除
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {!teachers.length ? (
                  <TableRow>
                    <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                      暂无教师账号
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <School className="h-5 w-5" />
            班级管理
          </CardTitle>
          <CardDescription>新建班级后，教师即可在「学生管理」中向该班级添加学生。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="class-name">班级名称</Label>
            <Input
              id="class-name"
              value={cName}
              onChange={(e) => setCName(e.target.value)}
              placeholder="如：七年级(2)班"
            />
          </div>
          <div className="flex items-end">
            <Button onClick={createClass} disabled={creating} className="gap-1">
              <Plus className="h-4 w-4" />
              {creating ? "创建中…" : "新建班级"}
            </Button>
          </div>
          <div className="space-y-2 md:col-span-3">
            {!classes ? <Skeleton className="h-16" /> : null}
            {classes ? (
              <div className="flex flex-wrap gap-2">
                {classes.map((c) => (
                  <Badge key={c.id} variant="secondary" className="text-sm">
                    {c.name}（{c.studentCount} 名学生）
                  </Badge>
                ))}
                {!classes.length ? (
                  <p className="text-sm text-muted-foreground">暂无班级，使用上方表单创建。</p>
                ) : null}
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* 删除教师确认 */}
      <Dialog open={Boolean(deleteTarget)} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除教师</DialogTitle>
            <DialogDescription>
              确定删除教师 {deleteTarget?.name} 吗？该操作不可撤销。若该教师名下存在业务数据将无法删除。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              取消
            </Button>
            <Button variant="destructive" onClick={deleteTeacher} disabled={deleting}>
              {deleting ? "删除中…" : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 重置密码对话框 */}
      <Dialog open={Boolean(resetTarget)} onOpenChange={(o) => !o && setResetTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重置教师密码</DialogTitle>
            <DialogDescription>
              为 {resetTarget?.name} 设置新密码（4–32 位），并请提醒其妥善保管。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="admin-reset-password">新密码</Label>
            <Input
              id="admin-reset-password"
              type="password"
              value={resetPassword}
              maxLength={32}
              onChange={(e) => setResetPassword(e.target.value)}
              placeholder="4–32 位"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetTarget(null)}>
              取消
            </Button>
            <Button onClick={doResetPassword} disabled={resetting}>
              {resetting ? "重置中…" : "确认重置"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 设置教师绑定（班主任/科目教师） */}
      <Dialog open={Boolean(bindTarget)} onOpenChange={(o) => !o && setBindTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>设置教师绑定</DialogTitle>
            <DialogDescription>
              为 {bindTarget?.name} 设置权限范围：班主任只能查看本班数据；科目教师只能查看本学科数据；未绑定为全量权限。修改后该教师重新登录生效。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label>班主任 · 绑定班级</Label>
              <Select
                value={bindClassId}
                onValueChange={(v) => {
                  setBindClassId(v);
                  if (v !== NONE) setBindSubjectId(NONE);
                }}
              >
                <SelectTrigger aria-label="班主任绑定班级">
                  <SelectValue placeholder="选择班级" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>无（全量权限）</SelectItem>
                  {(classes ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>科目教师 · 绑定科目</Label>
              <Select
                value={bindSubjectId}
                onValueChange={(v) => {
                  setBindSubjectId(v);
                  if (v !== NONE) setBindClassId(NONE);
                }}
              >
                <SelectTrigger aria-label="科目教师绑定科目">
                  <SelectValue placeholder="选择科目" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>无（全量权限）</SelectItem>
                  {(subjects ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBindTarget(null)}>
              取消
            </Button>
            <Button onClick={doSaveBinding} disabled={binding}>
              {binding ? "保存中…" : "保存绑定"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
