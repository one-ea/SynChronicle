import { describe, expect, it } from "vitest";
import { createDevelopmentProcesses } from "./dev-web.js";

describe("web development process configuration", () => {
  it("starts Fastify and Vite with aligned public origins", () => {
    const processes = createDevelopmentProcesses({ ...process.env, PUBLIC_URL: undefined });

    expect(processes.map((process) => process.name)).toEqual(["server-build", "fastify", "vite"]);
    expect(processes.find((process) => process.name === "fastify")?.env.PUBLIC_URL).toBe("http://localhost:5173");
    expect(processes.find((process) => process.name === "fastify")?.env.PORT).toBe("3000");
  });

  it("derives the Vite port and proxy target from custom development URLs", () => {
    const processes = createDevelopmentProcesses({
      ...process.env,
      PUBLIC_URL: "http://localhost:6200",
      PORT: "3300",
    });

    expect(processes.find((process) => process.name === "vite")?.args).toContain("6200");
    expect(processes.find((process) => process.name === "vite")?.env.VITE_BACKEND_URL).toBe("http://localhost:3300");
  });
});
