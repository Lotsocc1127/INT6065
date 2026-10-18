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
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
