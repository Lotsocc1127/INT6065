/** 临时测试脚本：验证 F7 多模型路由的降级机制（本地 HTTP stub，不走外网） */
import http from "http";

const results: string[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) throw new Error(`断言失败: ${name} ${detail}`);
};

async function main() {
  // 本地 stub 服务器：/openai/bad 返回非 JSON，/anthropic/ok 返回合法 JSON
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url?.startsWith("/anthropic/ok")) {
      res.end(JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ ok: true, via: "anthropic" }) }] }));
    } else {
      res.end(JSON.stringify({ choices: [{ message: { content: "这不是 JSON 的乱码输出" } }] }));
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  process.env.LLM_CHAIN = "deepseek,anthropic";
  process.env.DEEPSEEK_API_KEY = "fake";
  process.env.ANTHROPIC_API_KEY = "fake";

  // 用例 1：deepseek 返回非 JSON（解析失败）→ 降级 anthropic 成功
  process.env.DEEPSEEK_BASE_URL = `${base}/openai/bad`;
  process.env.ANTHROPIC_BASE_URL = `${base}/anthropic/ok`;
  const { llmJson, llmChat, llmConfigured, LlmError } = await import("../lib/llm");
  const r1 = await llmJson<{ ok: boolean; via: string }>(
    [{ role: "system", content: "测试" }, { role: "user", content: "返回 JSON" }],
    { maxTokens: 128 }
  );
  check("JSON 解析失败降级到下一候选并成功", r1.ok === true && r1.via === "anthropic", JSON.stringify(r1));

  // 用例 2：deepseek 网络不可达 → 降级 anthropic 成功
  process.env.DEEPSEEK_BASE_URL = "http://127.0.0.1:1"; // 拒绝连接
  const r2 = await llmChat([{ role: "user", content: "hi" }], { maxTokens: 128 });
  check("网络失败降级到下一候选并成功", r2.includes("anthropic"), r2.slice(0, 60));

  // 用例 3：两个候选全部失败 → 聚合错误
  process.env.ANTHROPIC_BASE_URL = "http://127.0.0.1:1";
  let errMsg = "";
  try {
    await llmChat([{ role: "user", content: "hi" }]);
  } catch (e) {
    errMsg = e instanceof Error ? e.message : String(e);
  }
  check("全部失败抛聚合错误（含数量与原因）", errMsg.includes("全部候选模型调用失败（共 2 个") && errMsg.includes("最后尝试 anthropic"), errMsg.slice(0, 80));

  // 用例 4：任务级候选链覆盖（GRADE 只用 deepseek，不落到 anthropic）
  process.env.LLM_CHAIN_GRADE = "deepseek";
  process.env.LLM_CHAIN = "anthropic";
  process.env.ANTHROPIC_BASE_URL = `${base}/anthropic/ok`;
  let gradeErr = "";
  try {
    await llmJson<unknown>([{ role: "user", content: "grade" }], { task: "grade" });
  } catch (e) {
    gradeErr = e instanceof Error ? e.message : String(e);
  }
  check("任务级 LLM_CHAIN_GRADE 覆盖全局链", gradeErr.includes("全部候选模型调用失败（共 1 个") && gradeErr.includes("最后尝试 deepseek"), gradeErr.slice(0, 80));
  const r4 = await llmJson<{ via: string }>([{ role: "user", content: "default" }]);
  check("未指定任务走全局链", r4.via === "anthropic", JSON.stringify(r4));

  // 用例 5：无任何 Key → llmConfigured false + 明确报错
  delete process.env.LLM_CHAIN_GRADE;
  process.env.LLM_CHAIN = "";
  process.env.DEEPSEEK_API_KEY = "";
  process.env.ANTHROPIC_API_KEY = "";
  check("无 Key 时 llmConfigured 为 false", llmConfigured() === false);
  let noKeyErr = "";
  try {
    await llmChat([{ role: "user", content: "hi" }]);
  } catch (e) {
    noKeyErr = e instanceof LlmError ? e.message : String(e);
  }
  check("无 Key 时抛明确提示", noKeyErr.includes("未配置任何可用的 LLM API Key"), noKeyErr.slice(0, 60));

  server.close();
  console.log("\n" + results.join("\n"));
  console.log(`\n全部 ${results.length} 个用例通过`);
}

main().catch((e) => {
  console.error(e.message);
  console.log("\n" + results.join("\n"));
  process.exit(1);
});
