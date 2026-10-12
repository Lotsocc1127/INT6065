"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface SubjectInfo {
  code: string;
  name: string;
}

/** 科目切换：把 ?subject= 写回 URL，页面通过查询参数驱动数据 */
export function SubjectSwitcher({
  subjects,
  current,
}: {
  subjects: SubjectInfo[];
  current: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (subjects.length <= 1) return null;
  return (
    <Tabs
      value={current}
      onValueChange={(code) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set("subject", code);
        router.push(`${pathname}?${params.toString()}`);
      }}
    >
      <TabsList>
        {subjects.map((s) => (
          <TabsTrigger key={s.code} value={s.code}>
            {s.name}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
