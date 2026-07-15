import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpsRequest } from "node:https";
import type { Readable } from "node:stream";

export interface ResolvedAddress { address: string; family: 4 | 6 }
export type DnsResolver = (hostname: string) => Promise<ResolvedAddress[]>;
export interface ValidatedProviderUrl { url: URL; hostname: string; address: string; family: 4 | 6 }

export class ProviderUrlError extends Error {
  readonly code = "PROVIDER_URL_UNSAFE";
  constructor(message: string) { super(message); this.name = "ProviderUrlError"; }
}
export class ProviderTransportError extends Error {
  constructor(readonly code: "PROVIDER_CONNECT_TIMEOUT" | "PROVIDER_RESPONSE_TIMEOUT" | "PROVIDER_RESPONSE_TOO_LARGE", message: string) { super(message); this.name = "ProviderTransportError"; }
}

export const systemDnsResolver: DnsResolver = async (hostname) => lookup(hostname, { all: true, verbatim: true }) as Promise<ResolvedAddress[]>;

function ipv4Number(address: string): number {
  return address.split(".").reduce((value, part) => (value * 256 + Number(part)) >>> 0, 0);
}

function ipv4In(address: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4Number(address) & mask) === (ipv4Number(base) & mask);
}

function parseIpv6(address: string): bigint | null {
  let input = address.toLowerCase().replace(/^\[|\]$/g, "");
  const zone = input.indexOf("%");
  if (zone >= 0) input = input.slice(0, zone);
  const dotted = input.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (dotted) {
    if (isIP(dotted) !== 4) return null;
    const value = ipv4Number(dotted);
    input = input.slice(0, input.length - dotted.length) + `${(value >>> 16).toString(16)}:${(value & 0xffff).toString(16)}`;
  }
  if (input.split("::").length > 2) return null;
  const [leftText, rightText] = input.split("::") as [string, string?];
  const left = leftText ? leftText.split(":") : [];
  const right = rightText ? rightText.split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((rightText === undefined && missing !== 0) || missing < 0) return null;
  const groups = rightText === undefined ? left : [...left, ...Array(missing).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.reduce((value, group) => (value << 16n) | BigInt(`0x${group}`), 0n);
}

function ipv6In(value: bigint, base: bigint, bits: number): boolean {
  const shift = 128n - BigInt(bits);
  return shift === 128n || (value >> shift) === (base >> shift);
}

function ipv6Cidr(address: string, bits: number): [bigint, number] {
  const value = parseIpv6(address);
  if (value === null) throw new Error(`invalid IPv6 CIDR ${address}`);
  return [value, bits];
}

export function isUnsafeProviderAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  const family = isIP(normalized);
  if (family === 4) return [
    ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
    ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
    ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
  ].some(([base, bits]) => ipv4In(normalized, String(base), Number(bits)));
  if (family === 6) {
    const value = parseIpv6(normalized);
    if (value === null) return true;
    if ((value >> 32n) === 0xffffn) {
      const mapped = Number(value & 0xffffffffn);
      const ipv4 = `${mapped >>> 24}.${(mapped >>> 16) & 255}.${(mapped >>> 8) & 255}.${mapped & 255}`;
      return isUnsafeProviderAddress(ipv4);
    }
    const blocked = [
      ipv6Cidr("64:ff9b::", 96),
      ipv6Cidr("64:ff9b:1::", 48),
      ipv6Cidr("2001::", 32),
      ipv6Cidr("2001:db8::", 32),
      ipv6Cidr("2002::", 16),
    ];
    if (blocked.some(([base, bits]) => ipv6In(value, base, bits))) return true;
    const global = ipv6Cidr("2000::", 3);
    if (!ipv6In(value, global[0], global[1])) return true;
    return false;
  }
  return true;
}

export async function validateProviderUrl(value: string, resolve: DnsResolver = systemDnsResolver): Promise<ValidatedProviderUrl> {
  let url: URL;
  try { url = new URL(value); } catch { throw new ProviderUrlError("provider URL is invalid"); }
  if (url.protocol !== "https:") throw new ProviderUrlError("provider URL must use https");
  if (url.username || url.password) throw new ProviderUrlError("provider URL credentials are forbidden");
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) throw new ProviderUrlError("provider URL host is forbidden");
  const literalFamily = isIP(hostname);
  const addresses = literalFamily ? [{ address: hostname, family: literalFamily as 4 | 6 }] : await resolve(hostname);
  if (!addresses.length) throw new ProviderUrlError("provider URL host did not resolve");
  if (addresses.some(({ address }) => isUnsafeProviderAddress(address))) throw new ProviderUrlError("provider URL resolved to an unsafe address");
  return { url, hostname, address: addresses[0]!.address, family: addresses[0]!.family };
}

export interface ProviderTransportLimits { connectTimeoutMs: number; overallTimeoutMs: number; readTimeoutMs: number; maxResponseBytes: number }
const defaultLimits: ProviderTransportLimits = { connectTimeoutMs: 10_000, overallTimeoutMs: 60_000, readTimeoutMs: 15_000, maxResponseBytes: 10 * 1024 * 1024 };

export function readBoundedResponse(stream: Readable, limits: Pick<ProviderTransportLimits, "overallTimeoutMs" | "readTimeoutMs" | "maxResponseBytes">): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const fail = (error: ProviderTransportError) => { if (settled) return; settled = true; clearTimeout(overall); clearTimeout(read); stream.destroy(error); reject(error); };
    const overall = setTimeout(() => fail(new ProviderTransportError("PROVIDER_RESPONSE_TIMEOUT", "provider response exceeded overall timeout")), limits.overallTimeoutMs);
    let read = setTimeout(() => fail(new ProviderTransportError("PROVIDER_RESPONSE_TIMEOUT", "provider response read timed out")), limits.readTimeoutMs);
    stream.on("data", (chunk) => {
      clearTimeout(read);
      const buffer = Buffer.from(chunk);
      size += buffer.length;
      if (size > limits.maxResponseBytes) return fail(new ProviderTransportError("PROVIDER_RESPONSE_TOO_LARGE", "provider response exceeded size limit"));
      chunks.push(buffer);
      read = setTimeout(() => fail(new ProviderTransportError("PROVIDER_RESPONSE_TIMEOUT", "provider response read timed out")), limits.readTimeoutMs);
    });
    stream.on("end", () => { if (settled) return; settled = true; clearTimeout(overall); clearTimeout(read); resolve(Buffer.concat(chunks)); });
    stream.on("error", (error) => { if (settled) return; settled = true; clearTimeout(overall); clearTimeout(read); reject(error); });
  });
}

export function createSecureProviderFetch(resolve: DnsResolver = systemDnsResolver, limits: Partial<ProviderTransportLimits> = {}, requester: typeof httpsRequest = httpsRequest): typeof fetch {
  const configured = { ...defaultLimits, ...limits };
  return async (input, init) => {
    const request = new Request(input, { ...init, redirect: "manual" });
    const validated = await validateProviderUrl(request.url, resolve);
    const body = request.method === "GET" || request.method === "HEAD" ? undefined : Buffer.from(await request.arrayBuffer());
    return new Promise<Response>((resolveResponse, reject) => {
      let settled = false;
      let connect: ReturnType<typeof setTimeout> | undefined;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        if (connect) clearTimeout(connect);
        clearTimeout(overall);
        outgoing.destroy(error);
        reject(error);
      };
      const overall = setTimeout(() => fail(new ProviderTransportError("PROVIDER_RESPONSE_TIMEOUT", "provider request exceeded overall timeout")), configured.overallTimeoutMs);
      const outgoing = requester(validated.url, {
        method: request.method,
        headers: Object.fromEntries(request.headers),
        signal: request.signal,
        lookup: (_hostname, _options, callback) => callback(null, validated.address, validated.family),
      }, (incoming) => {
        if (connect) clearTimeout(connect);
        void readBoundedResponse(incoming, configured).then((body) => { if (settled) return; settled = true; clearTimeout(overall); resolveResponse(new Response(new Uint8Array(body), { status: incoming.statusCode ?? 502, statusText: incoming.statusMessage, headers: incoming.headers as Record<string, string> })); }, (error) => { if (settled) return; settled = true; clearTimeout(overall); reject(error); });
      });
      connect = setTimeout(() => fail(new ProviderTransportError("PROVIDER_CONNECT_TIMEOUT", "provider connection timed out")), configured.connectTimeoutMs);
      outgoing.on("error", fail);
      if (body) outgoing.write(body);
      outgoing.end();
    });
  };
}
