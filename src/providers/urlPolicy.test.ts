import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { createSecureProviderFetch, ProviderUrlError, isUnsafeProviderAddress, parseProviderAllowedHosts, readBoundedResponse, validateProviderUrl } from "./urlPolicy.js";
import * as urlPolicy from "./urlPolicy.js";

describe("provider base URL policy", () => {
  it("exports a project provider host policy parser", () => {
    expect(typeof (urlPolicy as Record<string, unknown>).parseProviderAllowedHosts).toBe("function");
  });

  it("parses exact hosts and controlled subdomain suffixes by provider", () => {
    expect(parseProviderAllowedHosts(JSON.stringify({ openai: ["gateway.example.com", ".ai.example.net"] }))).toEqual(new Map([["openai", ["gateway.example.com", ".ai.example.net"]]]));
    expect(parseProviderAllowedHosts(undefined)).toEqual(new Map());
  });

  it.each([
    "[]",
    "not-json",
    JSON.stringify({ "OpenAI": ["gateway.example.com"] }),
    JSON.stringify({ openai: "gateway.example.com" }),
    JSON.stringify({ openai: ["*"] }),
    JSON.stringify({ openai: ["*.example.com"] }),
    JSON.stringify({ openai: [".com"] }),
    JSON.stringify({ openai: [".example.com"] }),
    JSON.stringify({ openai: ["https://example.com"] }),
    JSON.stringify({ openai: ["127.0.0.1"] }),
    JSON.stringify({ openai: ["localhost"] }),
  ])("rejects malformed project provider host policy %s", (value) => {
    expect(() => parseProviderAllowedHosts(value)).toThrow("PROJECT_PROVIDER_ALLOWED_HOSTS");
  });

  it("allows public HTTPS hosts and returns a pinned address", async () => {
    const resolve = vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }]);
    await expect(validateProviderUrl("https://api.openai.com/v1", resolve, "openai")).resolves.toMatchObject({ hostname: "api.openai.com", address: "93.184.216.34" });
  });

  it("rejects arbitrary public hosts and provider-host mismatches", async () => {
    const resolve = async () => [{ address: "93.184.216.34", family: 4 as const }];
    await expect(validateProviderUrl("https://api.example.com/v1", resolve, "openai")).rejects.toThrow("not allowed for provider");
    await expect(validateProviderUrl("https://api.anthropic.com/v1", resolve, "openai")).rejects.toThrow("not allowed for provider");
  });

  it("allows administrator exact hosts and controlled subdomain suffixes for one provider", async () => {
    const resolve = async () => [{ address: "93.184.216.34", family: 4 as const }];
    const allowedHosts = new Map([["openai", ["gateway.example.com", ".ai.example.net"]]]);
    await expect(validateProviderUrl("https://gateway.example.com/v1", resolve, "openai", allowedHosts)).resolves.toMatchObject({ hostname: "gateway.example.com" });
    await expect(validateProviderUrl("https://tenant.ai.example.net/v1", resolve, "openai", allowedHosts)).resolves.toMatchObject({ hostname: "tenant.ai.example.net" });
    await expect(validateProviderUrl("https://ai.example.net/v1", resolve, "openai", allowedHosts)).rejects.toThrow("not allowed for provider");
    await expect(validateProviderUrl("https://tenant.ai.example.net/v1", resolve, "anthropic", allowedHosts)).rejects.toThrow("not allowed for provider");
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
    await expect(validateProviderUrl("https://api.openai.com", async () => [{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }], "openai")).rejects.toThrow("unsafe address");
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

  it.each([
    "192.88.99.1",
    "2001:2::1",
    "2001:10::1",
    "2001:20::1",
    "3fff::1",
  ])("rejects IANA special-purpose address %s", (address) => {
    expect(isUnsafeProviderAddress(address)).toBe(true);
  });

  it("aborts slow and oversized response bodies", async () => {
    const slow = new Readable({ read() {} });
    await expect(readBoundedResponse(slow, { readTimeoutMs: 10, overallTimeoutMs: 20, maxResponseBytes: 1024 })).rejects.toMatchObject({ code: "PROVIDER_RESPONSE_TIMEOUT" });
    const large = Readable.from([Buffer.alloc(8), Buffer.alloc(8)]);
    await expect(readBoundedResponse(large, { readTimeoutMs: 100, overallTimeoutMs: 100, maxResponseBytes: 10 })).rejects.toMatchObject({ code: "PROVIDER_RESPONSE_TOO_LARGE" });
    expect(slow.destroyed).toBe(true);
  });

  it.each([
    ["connect", "PROVIDER_CONNECT_TIMEOUT", false, false],
    ["response header", "PROVIDER_RESPONSE_HEADER_TIMEOUT", true, false],
    ["overall", "PROVIDER_RESPONSE_TIMEOUT", true, true],
  ] as const)("rejects when the secure transport reaches the %s timeout", async (_name, code, secure, respond) => {
    const outgoing = new EventEmitter() as EventEmitter & { destroy(error: Error): void; end(): void; write(): void };
    outgoing.destroy = (error) => queueMicrotask(() => outgoing.emit("error", error));
    outgoing.end = vi.fn();
    outgoing.write = vi.fn();
    const requester = vi.fn((_url, _options, onResponse) => {
      if (secure) {
        const socket = new EventEmitter();
        queueMicrotask(() => {
          outgoing.emit("socket", socket);
          socket.emit("secureConnect");
        });
      }
      if (respond) queueMicrotask(() => onResponse(new Readable({ read() {} }) as never));
      return outgoing as never;
    });
    const secureFetch = createSecureProviderFetch("openai", new Map(), async () => [{ address: "93.184.216.34", family: 4 }], {
      connectTimeoutMs: 10,
      responseHeaderTimeoutMs: 15,
      overallTimeoutMs: 25,
      readTimeoutMs: 100,
      maxResponseBytes: 1024,
    }, requester as never);

    await expect(secureFetch("https://api.openai.com/v1")).rejects.toMatchObject({ code });
  });
});
