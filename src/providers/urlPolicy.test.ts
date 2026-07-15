import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { createSecureProviderFetch, ProviderUrlError, isUnsafeProviderAddress, readBoundedResponse, validateProviderUrl } from "./urlPolicy.js";

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

  it.each([
    "::ffff:7f00:1",
    "0:0:0:0:0:ffff:0a00:0001",
    "::ffff:100.64.0.1",
    "::ffff:a9fe:1",
    "::ffff:c0a8:101",
  ])("normalizes mapped IPv4 and reuses IPv4 CIDR policy for %s", (address) => {
    expect(isUnsafeProviderAddress(address)).toBe(true);
  });

  it.each(["::ffff:8.8.8.8", "0:0:0:0:0:ffff:0808:0808"])("allows mapped public IPv4 address %s", (address) => {
    expect(isUnsafeProviderAddress(address)).toBe(false);
  });

  it.each(["2002:0808:0808::1", "2001:0000:4136:e378:8000:63bf:3fff:fdd2", "64:ff9b::808:808", "64:ff9b:1::808:808", "::8.8.8.8", "2001:db8::1", "100::1", "fe80::1", "fc00::1", "ff02::1"])("rejects non-global and IPv4-conversion range %s", (address) => {
    expect(isUnsafeProviderAddress(address)).toBe(true);
  });

  it.each(["2606:4700:4700::1111", "2001:4860:4860::8888"])("allows global unicast IPv6 %s", (address) => {
    expect(isUnsafeProviderAddress(address)).toBe(false);
  });

  it("aborts slow and oversized response bodies", async () => {
    const slow = new Readable({ read() {} });
    await expect(readBoundedResponse(slow, { readTimeoutMs: 10, overallTimeoutMs: 20, maxResponseBytes: 1024 })).rejects.toMatchObject({ code: "PROVIDER_RESPONSE_TIMEOUT" });
    const large = Readable.from([Buffer.alloc(8), Buffer.alloc(8)]);
    await expect(readBoundedResponse(large, { readTimeoutMs: 100, overallTimeoutMs: 100, maxResponseBytes: 10 })).rejects.toMatchObject({ code: "PROVIDER_RESPONSE_TOO_LARGE" });
    expect(slow.destroyed).toBe(true);
  });

  it.each([
    ["connect", "PROVIDER_CONNECT_TIMEOUT", false],
    ["overall", "PROVIDER_RESPONSE_TIMEOUT", true],
  ] as const)("rejects when the secure transport reaches the %s timeout", async (_name, code, respond) => {
    const outgoing = new EventEmitter() as EventEmitter & { destroy(error: Error): void; end(): void; write(): void };
    outgoing.destroy = (error) => queueMicrotask(() => outgoing.emit("error", error));
    outgoing.end = vi.fn();
    outgoing.write = vi.fn();
    const requester = vi.fn((_url, _options, onResponse) => {
      if (respond) queueMicrotask(() => onResponse(new Readable({ read() {} }) as never));
      return outgoing as never;
    });
    const secureFetch = createSecureProviderFetch(async () => [{ address: "93.184.216.34", family: 4 }], {
      connectTimeoutMs: 10,
      overallTimeoutMs: 20,
      readTimeoutMs: 100,
      maxResponseBytes: 1024,
    }, requester as never);

    await expect(secureFetch("https://api.example.com/v1")).rejects.toMatchObject({ code });
  });
});
