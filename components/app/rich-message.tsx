"use client";

import katex from "katex";
import React, { Fragment, type ReactNode } from "react";

const MATH_RE = /(\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$\$[\s\S]*?\$\$)/g;

/** 把常见 LaTeX 命令降级成七年级能读的普通文本（KaTeX 失败时兜底）。 */
function plainMath(input: string): string {
  return input
    .replace(/\\times/g, "×")
    .replace(/\\div/g, "÷")
    .replace(/\\cdot/g, "·")
    .replace(/\\pm/g, "±")
    .replace(/\\left|\\right/g, "")
    .replace(/\\leq?/g, "≤")
    .replace(/\\geq?/g, "≥")
    .replace(/\\neq/g, "≠")
    .replace(/\\approx/g, "≈")
    .replace(/\\pi/g, "π")
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "($1)/($2)")
    .replace(/\\sqrt\{([^{}]+)\}/g, "√($1)")
    .replace(/\^\{?2\}?/g, "²")
    .replace(/\^\{?3\}?/g, "³")
    .replace(/\\[a-zA-Z]+/g, "")
    .replace(/[{}]/g, "")
    .replace(/\\/g, "");
}

/** 只处理 **bold**；其余按纯文本渲染，避免把模型输出当 HTML。 */
function renderText(segment: string): ReactNode[] {
  return segment
    .replace(/\\[()[\]]/g, "")
    .split(/(\*\*[\s\S]+?\*\*)/g)
    .filter(Boolean)
    .map((part, index) => {
      if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
        return <strong key={`b-${index}`}>{part.slice(2, -2)}</strong>;
      }
      return <Fragment key={`t-${index}`}>{part.replace(/\*\*/g, "")}</Fragment>;
    });
}

/**
 * 苏格拉底对话的轻量富文本：
 * - **加粗** -> <strong>
 * - \( ... \) / \[ ... \] / $$ ... $$ -> KaTeX
 * - 解析失败 -> 去掉反斜杠/定界符，按普通文本显示
 *
 * 不引入 react-markdown，避免把聊天内容按整篇文档解析；
 * 模型仍被 prompt 要求优先输出纯文本 + Unicode 数学符号。
 */
export function RichMessage({ content }: { content: string }) {
  const nodes: ReactNode[] = [];
  let last = 0;
  const re = new RegExp(MATH_RE.source, "g");
  let match: RegExpExecArray | null;

  while ((match = re.exec(content)) !== null) {
    const index = match.index;
    if (index > last) nodes.push(...renderText(content.slice(last, index)));

    const raw = match[0];
    const display = raw.startsWith("\\[") || raw.startsWith("$$");
    const expr = raw
      .replace(/^\\\[/, "")
      .replace(/\\\]$/, "")
      .replace(/^\\\(/, "")
      .replace(/\\\)$/, "")
      .replace(/^\$\$/, "")
      .replace(/\$\$$/, "")
      .trim();

    let html = "";
    try {
      html = katex.renderToString(expr, {
        throwOnError: true,
        displayMode: display,
        strict: false,
        trust: false,
      });
    } catch {
      nodes.push(<Fragment key={`m-${index}`}>{plainMath(expr)}</Fragment>);
      last = index + raw.length;
      continue;
    }

    nodes.push(
      display ? (
        <div
          key={`m-${index}`}
          className="katex-block"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <span
          key={`m-${index}`}
          className="katex-inline"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )
    );
    last = index + raw.length;
  }

  if (last < content.length) nodes.push(...renderText(content.slice(last)));
  return <>{nodes}</>;
}
