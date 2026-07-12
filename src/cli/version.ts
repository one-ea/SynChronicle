import packageJson from "../../package.json";

export interface VersionInfo { version: string; commit?: string; date?: string }
export function normalizeVersion(value: string): string { const version = value.trim(); return !version || version === "(devel)" ? "dev" : version === "dev" || version.startsWith("v") ? version : `v${version}`; }
export function formatVersion(info: VersionInfo): string { return `SynChronicle ${normalizeVersion(info.version)}\ncommit: ${info.commit?.trim() || "unknown"}\nbuilt: ${info.date?.trim() || "unknown"}\n`; }
export function printVersion(write: (text: string) => void = (text) => process.stdout.write(text)): void { write(formatVersion({ version: packageJson.version, commit: process.env.SYNCHRONICLE_COMMIT, date: process.env.SYNCHRONICLE_BUILD_DATE })); }
