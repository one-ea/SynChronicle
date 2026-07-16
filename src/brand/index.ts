import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function checkBrandContract(root: string, packFiles: string[]): string[] {
  const issues: string[] = [];
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    name?: string;
    bin?: Record<string, string>;
    engines?: { node?: string };
    files?: string[];
    license?: string;
  };
  if (pkg.name !== "synchronicle" || pkg.bin?.synchronicle !== "./dist/cli/index.js") issues.push("package identity");
  if (pkg.engines?.node !== ">=24") issues.push("node engine");
  if (pkg.files?.includes("assets") || !pkg.files?.includes("assets/**/*.md")) issues.push("package files");
  if (pkg.license !== "Apache-2.0") issues.push("package license");

  const readme = readFileSync(join(root, "README.md"), "utf8");
  for (const term of [/\bgo install\b/i, /\bbinary archive\b/i, /二进制归档/]) {
    if (term.test(readme)) issues.push(`README:${term.source}`);
  }

  const license = readFileSync(join(root, "LICENSE"));
  if (createHash("sha256").update(license).digest("hex") !== "c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4") issues.push("LICENSE");
  if (readFileSync(join(root, "NOTICE"), "utf8") !== "SynChronicle\nCopyright 2026 one-ea\n\nLicensed under the Apache License, Version 2.0.\n") issues.push("NOTICE");
  for (const file of ["package/dist/cli/index.js", "package/README.md", "package/LICENSE", "package/NOTICE"]) {
    if (!packFiles.includes(file)) issues.push(`pack:${file}`);
  }
  if (packFiles.includes("package/assets/load.go")) issues.push("pack:package/assets/load.go");
  return issues;
}
