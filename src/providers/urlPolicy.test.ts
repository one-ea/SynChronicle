import { describe, expect, it, vi } from "vitest";
import { ProviderUrlError, validateProviderUrl } from "./urlPolicy.js";

describe("provider base URL policy", () => {
  it("allows public HTTPS hosts and returns a pinned address", async () => {
    const resolve = vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }]);
    await expect(validateProviderUrl("https://api.example.com/v1", resolve)).resolves.toMatchObject({ hostname: "api.example.com", address: "93.184.216.34" });
  });

  it.each([
    "http://api.example.com",
    "https://localhost",
    "https://127.0.0.1",
    "https://169.254.169.254/latest/meta-data",
    "https://10.0.0.1",
    "https://172.16.0.1",
    "https://192.168.1.1",
    "https://[::1]",
    "https://[fc00::1]",
    "https://224.0.0.1",
  ])("rejects unsafe endpoint %s", async (url) => {
    await expect(validateProviderUrl(url, async (hostname) => [{ address: hostname.replace(/[\[\]]/g, ""), family: hostname.includes(":") ? 6 : 4 } as never])).rejects.toBeInstanceOf(ProviderUrlError);
  });

  it("rejects DNS rebinding when any resolved address is private", async () => {
    await expect(validateProviderUrl("https://api.example.com", async () => [{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }])).rejects.toThrow("unsafe address");
  });
});
