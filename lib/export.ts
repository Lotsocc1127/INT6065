/**
 * Excel 导出工具（仅服务端使用；client 组件不得 import 本文件，见 lib/download.ts）。
 */
import ExcelJS from "exceljs";
import { NextResponse } from "next/server";

/** 生成 .xlsx 响应（中文文件名用 RFC 5987 编码，防乱码） */
export async function xlsxResponse(wb: ExcelJS.Workbook, filename: string): Promise<NextResponse> {
  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}

/** 填一张表：表头加粗 + 按表头长度设列宽；单元格值统一 String()（null → "—"） */
export function fillSheet(
  ws: ExcelJS.Worksheet,
  headers: string[],
  rows: (string | number | null)[][]
): void {
  ws.columns = headers.map((h) => ({ header: h, width: Math.max(12, h.length * 2 + 4) }));
  for (const row of rows) {
    ws.addRow(row.map((v) => (v == null ? "—" : String(v))));
  }
  ws.getRow(1).font = { bold: true };
}
