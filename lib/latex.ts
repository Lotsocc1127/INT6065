/** 移除 AI 输出中常见的 LaTeX 标记，数学符号转普通文本（防止页面乱码） */
export function stripLatex(s: string): string {
  return s
    .replace(/\$\$?/g, "") // $...$ 定界符
    .replace(/\\[\(\[]|\\[\)\]]/g, "") // \( \) \[ \]
    .replace(/\\(frac|dfrac)\{([^{}]*)\}\{([^{}]*)\}/g, "($2)/($3)")
    .replace(/\\sqrt\{([^{}]*)\}/g, "√($1)")
    .replace(/\\times/g, "×")
    .replace(/\\div/g, "÷")
    .replace(/\\cdot/g, "·")
    .replace(/\\pm/g, "±")
    .replace(/\\leq/g, "≤")
    .replace(/\\geq/g, "≥")
    .replace(/\\neq|\\ne/g, "≠")
    .replace(/\\angle/g, "∠")
    .replace(/\\circ/g, "°")
    .replace(/\\prime/g, "′")
    .replace(/\\(overline|overleftrightarrow|mathrm|mathbf|textit|text)\{([^{}]*)\}/g, "$2");
}
