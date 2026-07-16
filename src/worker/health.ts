import { randomUUID } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";

export type WorkerHealthPayload = { pid: number; nonce: string; startedAt: number };

export async function clearWorkerHealth(path: string): Promise<void> {
  await unlink(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

export async function prepareWorkerHealth(path: string, identity: { pid?: number; nonce?: string; now?: number } = {}): Promise<{ payload: WorkerHealthPayload; cleanup: () => Promise<void> }> {
  await clearWorkerHealth(path);
  const payload = { pid: identity.pid ?? process.pid, nonce: identity.nonce ?? randomUUID(), startedAt: identity.now ?? Date.now() };
  await writeFile(path, JSON.stringify(payload), { mode: 0o600, flag: "wx" });
  return {
    payload,
    cleanup: async () => {
      try {
        const current = JSON.parse(await readFile(path, "utf8")) as Partial<WorkerHealthPayload>;
        if (current.nonce === payload.nonce) await unlink(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    },
  };
}
