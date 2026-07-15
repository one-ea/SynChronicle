export async function startWorker(): Promise<void> {}

if (import.meta.url === `file://${process.argv[1]}`) await startWorker();
