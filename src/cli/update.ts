import { spawn } from "node:child_process";

interface UpdateDependencies { currentVersion?: string; fetchPackage?: (target: string) => Promise<{ version: string }>; install?: (spec: string) => Promise<void>; writeStdout?: (text: string) => void }
export async function updateCommand(target = "", deps: UpdateDependencies = {}): Promise<void> {
  const fetchPackage = deps.fetchPackage ?? fetchFromRegistry;
  const install = deps.install ?? installGlobal;
  const write = deps.writeStdout ?? ((text) => process.stdout.write(text));
  const metadata = await fetchPackage(target || "latest");
  const version = normalize(metadata.version);
  if (normalize(deps.currentVersion ?? "") === version) { write(`SynChronicle 已是最新版本 v${version}\n`); return; }
  await install(`synchronicle@${version}`);
  write(`SynChronicle 已更新到 v${version}\n`);
}
async function fetchFromRegistry(target: string): Promise<{ version: string }> { const response = await fetch(`https://registry.npmjs.org/synchronicle/${encodeURIComponent(target)}`); if (!response.ok) throw new Error(`npm registry: ${response.status} ${response.statusText}`); return await response.json() as { version: string }; }
function installGlobal(spec: string): Promise<void> { return new Promise((resolve, reject) => { const child = spawn("npm", ["install", "-g", spec], { stdio: "inherit" }); child.once("error", reject); child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`npm install exited with ${code ?? "signal"}`))); }); }
function normalize(version: string): string { return version.trim().replace(/^v/, ""); }
