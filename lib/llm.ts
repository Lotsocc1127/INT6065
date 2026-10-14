/**
 * LLM 统一封装（开发文档第 7.1 节 + F7 多模型路由）
 * 支持 OpenAI / Anthropic / DeepSeek / 智谱，全部使用原生 fetch（服务端路由内调用）。
 *
 * 多模型路由与自动降级：
 * - 候选链 = 任务级 LLM_CHAIN_<TASK>（TASK 为大写任务名，如 LLM_CHAIN_GRADE）
 *   或全局 LLM_CHAIN，逗号分隔的 provider 列表（如 "deepseek,anthropic"）；
 *   未配置时默认 LLM_PROVIDER 优先、其余按偏好顺序，仅保留已配 Key 的 provider。
 * - 单个候选失败（网络/4xx-5xx/空内容/JSON 解析失败）自动切换下一个，
 *   全部失败抛聚合错误；llmConfigured() 按候选链判断是否有可用模型。
 */
import { extractJson } from "./json";

export type ChatRole = "system" | "user" | "assistant";
export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export type LlmProvider = "deepseek" | "openai" | "anthropic" | "zhipu";

/** 任务类型：对应 LLM_CHAIN_<TASK> 环境变量；不传走全局链 */
export type LlmTask =
  | "grade"
  | "homework"
  | "verify"
  | "suggest"
  | "similar"
  | "socrates"
  | "prep"
  | "analysis"
  | "default";

export interface LlmOptions {
  /** 要求结构化 JSON 输出 */
  json?: boolean;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** 任务标签：用于按任务路由候选链 */
  task?: LlmTask;
}

interface ProviderConfig {
  baseUrl: string;
  /** 可覆盖 baseUrl 的环境变量（中转/代理或本地测试用） */
  baseUrlEnv: string;
  keyEnv: string;
  modelEnv: string;
  defaultModel: string;
  openaiCompatible: boolean;
}

const PROVIDERS: Record<LlmProvider, ProviderConfig> = {
  deepseek: {
    baseUrl: "https://api.deepseek.com/chat/completions",
    baseUrlEnv: "DEEPSEEK_BASE_URL",
    keyEnv: "DEEPSEEK_API_KEY",
    modelEnv: "DEEPSEEK_MODEL",
    defaultModel: "deepseek-chat",
    openaiCompatible: true,
  },
  openai: {
    baseUrl: "https://api.openai.com/v1/chat/completions",
    baseUrlEnv: "OPENAI_BASE_URL",
    keyEnv: "OPENAI_API_KEY",
    modelEnv: "OPENAI_MODEL",
    defaultModel: "gpt-4o-mini",
    openaiCompatible: true,
  },
  zhipu: {
    baseUrl: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    baseUrlEnv: "ZHIPU_BASE_URL",
    keyEnv: "ZHIPU_API_KEY",
    modelEnv: "ZHIPU_MODEL",
    defaultModel: "glm-4-air",
    openaiCompatible: true,
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com/v1/messages",
    baseUrlEnv: "ANTHROPIC_BASE_URL",
    keyEnv: "ANTHROPIC_API_KEY",
    modelEnv: "ANTHROPIC_MODEL",
    defaultModel: "claude-opus-5-5",
    openaiCompatible: false,
  },
};

const VALID_PROVIDERS = Object.keys(PROVIDERS) as LlmProvider[];

export function getProvider(): LlmProvider {
  const p = (process.env.LLM_PROVIDER ?? "deepseek").toLowerCase();
  return p in PROVIDERS ? (p as LlmProvider) : "deepseek";
}

/** 该 provider 是否已配置 Key */
function hasKey(provider: LlmProvider): boolean {
  return Boolean(process.env[PROVIDERS[provider].keyEnv]);
}

/** 解析候选链：任务级 LLM_CHAIN_<TASK> > 全局 LLM_CHAIN > 默认（LLM_PROVIDER 优先） */
function resolveChain(task?: LlmTask): LlmProvider[] {
  const raw =
    task && task !== "default"
      ? process.env[`LLM_CHAIN_${task.toUpperCase()}`] ?? ""
      : "";
  const list = (raw || process.env.LLM_CHAIN || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is LlmProvider => VALID_PROVIDERS.includes(s as LlmProvider));
  const chain = list.length
    ? [...new Set(list)]
    : [getProvider(), ...VALID_PROVIDERS.filter((p) => p !== getProvider())];
  return [...new Set(chain)].filter(hasKey);
}

/** 是否有可用模型：候选链非空（不再只看单一 LLM_PROVIDER 的 Key） */
export function llmConfigured(provider?: LlmProvider): boolean {
  if (provider) return hasKey(provider);
  return resolveChain().length > 0;
}

export class LlmError extends Error {}

/** 单个 provider 的实际 HTTP 调用（不含降级逻辑） */
async function callProvider(
  provider: LlmProvider,
  messages: ChatMessage[],
  opts: LlmOptions
): Promise<string> {
  const cfg = PROVIDERS[provider];
  const apiKey = process.env[cfg.keyEnv];
  if (!apiKey) {
    throw new LlmError(`未配置 ${cfg.keyEnv}。请在 .env 中填写对应平台的 API Key，或调整 LLM_CHAIN 候选链。`);
  }
  const baseUrl = process.env[cfg.baseUrlEnv] || cfg.baseUrl;
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
    const res = await fetch(baseUrl, {
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
  const res = await fetch(baseUrl, {
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

/** 沿候选链逐个尝试，失败自动降级到下一个 */
async function runWithFallback<T>(
  task: LlmTask | undefined,
  attempt: (p: LlmProvider) => Promise<T>
): Promise<T> {
  const chain = resolveChain(task);
  if (!chain.length) {
    throw new LlmError(
      "未配置任何可用的 LLM API Key。请在 .env 填写任一 provider 的 Key（如 DEEPSEEK_API_KEY），或设置 LLM_CHAIN 指定候选链。"
    );
  }
  let lastErr: unknown;
  for (const p of chain) {
    try {
      return await attempt(p);
    } catch (e) {
      lastErr = e;
      if (chain.length > 1) {
        console.warn(
          `[llm] ${p} 失败，降级到下一个候选模型: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`
        );
      }
    }
  }
  const detail = lastErr instanceof Error ? lastErr.message : String(lastErr);
  const lastProvider = chain[chain.length - 1];
  throw new LlmError(`全部候选模型调用失败（共 ${chain.length} 个，最后尝试 ${lastProvider}）: ${detail}`);
}

/** 核心调用：返回模型文本输出（自动降级） */
export async function llmChat(messages: ChatMessage[], opts: LlmOptions = {}): Promise<string> {
  return runWithFallback(opts.task, (p) => callProvider(p, messages, { ...opts, json: false }));
}

/** 结构化 JSON 调用：容错解析；解析失败同样触发降级 */
export async function llmJson<T>(messages: ChatMessage[], opts: LlmOptions = {}): Promise<T> {
  return runWithFallback(opts.task, async (p) => {
    const text = await callProvider(p, messages, { ...opts, json: true });
    return extractJson(text) as T;
  });
}
