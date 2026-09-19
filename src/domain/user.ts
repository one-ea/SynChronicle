import { z } from "zod";

export const UserRole = z.enum(["admin", "writer"]);
export type UserRole = z.infer<typeof UserRole>;

export const UserRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(2).max(32),
  role: UserRole.default("writer"),
  salt: z.string().min(16),
  hash: z.string().min(64),
  createdAt: z.string(),
  disabled: z.boolean().default(false),
});
export type UserRecord = z.infer<typeof UserRecordSchema>;

export const UsersFileSchema = z.object({
  users: z.array(UserRecordSchema).default([]),
  updatedAt: z.string(),
});
export type UsersFile = z.infer<typeof UsersFileSchema>;

export function validatePassword(password: string): string | null {
  if (password.length < 8) return "密码至少需要 8 位";
  if (password.length > 256) return "密码最多允许 256 位";
  return null;
}
