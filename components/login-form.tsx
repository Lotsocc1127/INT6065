"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

interface DemoUser {
  id: string;
  name: string;
  role: string;
  className: string | null;
}

export function LoginForm({ users }: { users: DemoUser[] }) {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("123456");
  const [loading, setLoading] = useState(false);

  const admins = users.filter((u) => u.role === "ADMIN");
  const teachers = users.filter((u) => u.role === "TEACHER");
  const students = users.filter((u) => u.role === "STUDENT");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) {
      toast.error("请选择登录身份");
      return;
    }
    setLoading(true);
    const res = await signIn("credentials", { userId, password, redirect: false });
    setLoading(false);
    if (res?.error) {
      toast.error("登录失败：密码错误（演示账号密码均为 123456）");
      return;
    }
    const role = users.find((u) => u.id === userId)?.role;
    router.push(role === "STUDENT" ? "/student" : role === "ADMIN" ? "/admin" : "/teacher");
    router.refresh();
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <CardTitle className="text-xl">智学慧教</CardTitle>
        <CardDescription>数据驱动的教学成长平台</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>选择身份（演示账号）</Label>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="请选择教师或学生" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>管理员</SelectLabel>
                  {admins.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel>教师</SelectLabel>
                  {teachers.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel>学生</SelectLabel>
                  {students.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                      {u.className ? `（${u.className}）` : ""}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">密码</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="演示密码 123456"
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "登录中…" : "登录"}
          </Button>
          <div className="text-center text-xs text-muted-foreground">
            演示环境 · 全部账号密码为 <Badge variant="secondary">123456</Badge>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
