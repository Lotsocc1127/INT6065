/**
 * 客户端下载工具：fetch 后端导出接口 → blob → 触发浏览器下载。
 * 注意：此文件不得 import exceljs（保持 client bundle 干净）。
 */
export async function downloadXlsx(url: string, filename: string): Promise<void> {
  const r = await fetch(url);
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error((j as { error?: string }).error ?? "导出失败");
  }
  const blob = await r.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  // 锚点须挂进文档（Firefox/Safari 对游离锚点可能不触发下载）；
  // revoke 延迟到下一轮任务，避免浏览器异步取 blob 时已被回收导致静默失败
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
