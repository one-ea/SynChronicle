import argon2 from "argon2";

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
} as const;

export const DUMMY_PASSWORD_HASH = "$argon2id$v=19$m=65536,t=3,p=1$rK0svFu+zwdoZABS+jF1fA$9uJFCDrITTY0RuLSNVdcVYd/VU2uKPe25HguWyMdPM0";

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
