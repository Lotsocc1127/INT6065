"use client";

import { useEffect, useState } from "react";
import { Check, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const FONT_SIZES = [
  { key: "small", label: "小", px: 15 },
  { key: "medium", label: "标准", px: 16 },
  { key: "large", label: "大", px: 17.5 },
] as const;
const THEMES = [
  { key: "default", label: "默认（跟随系统）" },
  { key: "eye-green", label: "护眼绿" },
  { key: "eye-beige", label: "米黄" },
] as const;

type FontKey = (typeof FONT_SIZES)[number]["key"];
type ThemeKey = (typeof THEMES)[number]["key"];

/** 右上角显示设置：字体大小 + 背景主题（护眼模式），localStorage 持久化 */
export function SettingsMenu() {
  const [fontSize, setFontSize] = useState<FontKey>("medium");
  const [theme, setTheme] = useState<ThemeKey>("default");

  // 恢复已保存的设置
  useEffect(() => {
    const f = localStorage.getItem("app-font-size");
    if (f && FONT_SIZES.some((x) => x.key === f)) setFontSize(f as FontKey);
    const t = localStorage.getItem("app-theme");
    if (t && THEMES.some((x) => x.key === t)) setTheme(t as ThemeKey);
  }, []);

  useEffect(() => {
    const item = FONT_SIZES.find((x) => x.key === fontSize) ?? FONT_SIZES[1];
    document.documentElement.style.fontSize = `${item.px}px`;
    localStorage.setItem("app-font-size", fontSize);
  }, [fontSize]);

  useEffect(() => {
    if (theme === "default") document.documentElement.removeAttribute("data-app-theme");
    else document.documentElement.setAttribute("data-app-theme", theme);
    localStorage.setItem("app-theme", theme);
  }, [theme]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5" aria-label="显示设置">
          <Settings2 className="h-4 w-4" />
          <span className="hidden sm:inline">显示</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>字体大小</DropdownMenuLabel>
        {FONT_SIZES.map((f) => (
          <DropdownMenuItem key={f.key} onClick={() => setFontSize(f.key)}>
            <span className="flex w-8 items-center justify-start">
              {fontSize === f.key ? <Check className="h-4 w-4" /> : null}
            </span>
            {f.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>背景主题（护眼模式）</DropdownMenuLabel>
        {THEMES.map((t) => (
          <DropdownMenuItem key={t.key} onClick={() => setTheme(t.key)}>
            <span className="flex w-8 items-center justify-start">
              {theme === t.key ? <Check className="h-4 w-4" /> : null}
            </span>
            {t.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
