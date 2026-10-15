export const PASSWORD_MIN = 4;
export const PASSWORD_MAX = 32;
/** bcrypt 只取输入前 72 字节，超出部分被静默截断，故额外限制字节长度 */
const PASSWORD_MAX_BYTES = 72;

/** 密码统一校验：4–32 字符且 ≤72 字节；合法返回 null，否则返回错误文案 */
export function validatePassword(pw: string): string | null {
  if (pw.length < PASSWORD_MIN) return "密码至少 4 位";
  if (pw.length > PASSWORD_MAX) return "密码最多 32 位";
  if (new TextEncoder().encode(pw).length > PASSWORD_MAX_BYTES) return "密码过长（需 72 字节以内）";
  return null;
}
