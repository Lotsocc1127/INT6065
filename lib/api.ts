import { NextResponse } from "next/server";
import { AuthError } from "./auth";
import { LlmError } from "./llm";
import { SubmissionError } from "./grading";

export function ok(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

/** 统一的 API 错误处理 */
export function fail(e: unknown) {
  if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
  if (e instanceof SubmissionError) return NextResponse.json({ error: e.message }, { status: e.status });
  if (e instanceof LlmError) return NextResponse.json({ error: e.message }, { status: 502 });
  console.error("[api]", e);
  const msg = e instanceof Error ? e.message : "服务器错误";
  return NextResponse.json({ error: msg }, { status: 500 });
}
