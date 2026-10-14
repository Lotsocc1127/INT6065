/**
 * 家长分享链接：token 生成与哈希。
 * raw token 只在创建响应中出现一次，数据库仅存 SHA-256 哈希。
 */
import { createHash, randomBytes } from "crypto";

/** 24 字节随机 token（base64url，32 字符，URL 安全） */
export function generateShareToken(): string {
  return randomBytes(24).toString("base64url");
}

export function hashShareToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
