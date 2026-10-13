"use client";

import { usePathname } from "next/navigation";

/** 路由切换时重放淡入动画（布局本身不重挂载，需按 pathname 重新 key） */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="page-enter">
      {children}
    </div>
  );
}
