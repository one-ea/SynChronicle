interface PlaywrightWebServer {
  command: string;
  url: string;
  timeout: number;
  reuseExistingServer: boolean;
  env: NodeJS.ProcessEnv;
}

export function selectPlaywrightWebServer(argv: string[], env: NodeJS.ProcessEnv): PlaywrightWebServer {
  const projects: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument.startsWith("--project=")) projects.push(argument.slice("--project=".length));
    else if (argument === "--project" && argv[index + 1]) projects.push(argv[index + 1]!);
  }
  const responsiveOnly = projects.length > 0 && projects.every((project) => project === "responsive");
  if (responsiveOnly) {
    return {
      command: "pnpm exec vite --host 127.0.0.1 --port 4173",
      url: "http://127.0.0.1:4173/",
      timeout: 120_000,
      reuseExistingServer: false,
      env: { ...env },
    };
  }
  return {
    command: "pnpm exec vite-node scripts/e2e-server.ts",
    url: "http://127.0.0.1:4173/api/health/ready",
    timeout: 120_000,
    reuseExistingServer: false,
    env: { ...env, TEST_DATABASE_URL: env.TEST_DATABASE_URL ?? "" },
  };
}
