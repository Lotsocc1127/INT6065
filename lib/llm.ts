/**
 * LLM 统一封装（开发文档第 7.1 节）
 * 支持 OpenAI / Anthropic / DeepSeek / 智谱，通过环境变量 LLM_PROVIDER 切换。
 * 全部使用原生 fetch（服务端路由内调用），JSON 模式做容错解析。
 */
import { extractJson } from "./json";

export type ChatRole = "system" | "user" | "assistant";
export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export type LlmProvider = "deepseek" | "openai" | "anthropic" | "zhipu";

export interface LlmOptions {
  /** 要求结构化 JSON 输出 */
  json?: boolean;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

interface ProviderConfig {
  baseUrl: string;
  keyEnv: string;
  modelEnv: string;
  defaultModel: string;
  openaiCompatible: boolean;
}

const PROVIDERS: Record<LlmProvider, ProviderConfig> = {
  deepseek: {
    baseUrl: "https://api.deepseek.com/chat/completions",
    keyEnv: "DEEPSEEK_API_KEY",
    modelEnv: "DEEPSEEK_MODEL",
    defaultModel: "deepseek-chat",
    openaiCompatible: true,
  },
  openai: {
    baseUrl: "https://api.openai.com/v1/chat/completions",
    keyEnv: "OPENAI_API_KEY",
    modelEnv: "OPENAI_MODEL",
    defaultModel: "gpt-4o-mini",
    openaiCompatible: true,
  },
  zhipu: {
    baseUrl: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    keyEnv: "ZHIPU_API_KEY",
    modelEnv: "ZHIPU_MODEL",
    defaultModel: "glm-4-air",
    openaiCompatible: true,
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com/v1/messages",
    keyEnv: "ANTHROPIC_API_KEY",
    modelEnv: "ANTHROPIC_MODEL",
    defaultModel: "claude-opus-5-5",
    openaiCompatible: false,
  },
};

export function getProvider(): LlmProvider {
  const p = (process.env.LLM_PROVIDER ?? "deepseek").toLowerCase();
  return p in PROVIDERS ? (p as LlmProvider) : "deepseek";
}

export function llmConfigured(provider = getProvider()): boolean {
  const cfg = PROVIDERS[provider];
  return Boolean(process.env[cfg.keyEnv]);
}

export class LlmError extends Error {}

/** 核心调用：返回模型文本输出 */
export async function llmChat(messages: ChatMessage[], opts: LlmOptions = {}): Promise<string> {
  const provider = getProvider();
  const cfg = PROVIDERS[provider];
  const apiKey = process.env[cfg.keyEnv];
  if (!apiKey) {
    throw new LlmError(
      `未配置 ${cfg.keyEnv}。请在 .env 中填写对应平台的 API Key（当前 LLM_PROVIDER=${provider}），或切换 LLM_PROVIDER。`
    );
  }
  const model = opts.model ?? process.env[cfg.modelEnv] ?? cfg.defaultModel;
  const temperature = opts.temperature ?? 0.3;
  const maxTokens = opts.maxTokens ?? 4096;

  if (cfg.openaiCompatible) {
    const body: Record<string, unknown> = {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    };
    if (opts.json) body.response_format = { type: "json_object" };
    const res = await fetch(cfg.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new LlmError(`[${provider}] 请求失败 ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = await res.json();
    const content: string = data?.choices?.[0]?.message?.content ?? "";
    if (!content) throw new LlmError(`[${provider}] 返回内容为空`);
    return content;
  }

  // Anthropic Messages API
  let system: string | undefined;
  const systemParts = messages.filter((m) => m.role === "system").map((m) => m.content);
  if (systemParts.length) system = systemParts.join("\n\n");
  if (opts.json) {
    system = (system ? system + "\n\n" : "") + "只输出 JSON 对象，不要输出任何其他文字、注释或代码块标记。";
  }
  // 合并连续同角色消息，保证 user/assistant 交替
  const merged: ChatMessage[] = [];
  for (const m of messages.filter((m) => m.role !== "system")) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.content += "\n\n" + m.content;
    else merged.push({ ...m });
  }
  const res = await fetch(cfg.baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      ...(system ? { system } : {}),
      messages: merged,
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new LlmError(`[${provider}] 请求失败 ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const content = (data?.content ?? [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("");
  if (!content) throw new LlmError(`[${provider}] 返回内容为空`);
  return content;
}

/** 结构化 JSON 调用：llmChat + 容错解析 */
export async function llmJson<T>(messages: ChatMessage[], opts: LlmOptions = {}): Promise<T> {
  const text = await llmChat(messages, { ...opts, json: true });
  return extractJson(text) as T;
}
