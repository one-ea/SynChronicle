import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpsRequest } from "node:https";

export interface ResolvedAddress { address: string; family: 4 | 6 }
export type DnsResolver = (hostname: string) => Promise<ResolvedAddress[]>;
export interface ValidatedProviderUrl { url: URL; hostname: string; address: string; family: 4 | 6 }

export class ProviderUrlError extends Error {
  readonly code = "PROVIDER_URL_UNSAFE";
  constructor(message: string) { super(message); this.name = "ProviderUrlError"; }
}

export const systemDnsResolver: DnsResolver = async (hostname) => lookup(hostname, { all: true, verbatim: true }) as Promise<ResolvedAddress[]>;

function ipv4Number(address: string): number {
  return address.split(".").reduce((value, part) => (value * 256 + Number(part)) >>> 0, 0);
}

function ipv4In(address: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4Number(address) & mask) === (ipv4Number(base) & mask);
}

export function isUnsafeProviderAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  const family = isIP(normalized);
  if (family === 4) return [
    ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
    ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
    ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
  ].some(([base, bits]) => ipv4In(normalized, String(base), Number(bits)));
  if (family === 6) return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb") || normalized.startsWith("ff") || normalized.startsWith("2001:db8:") || normalized.startsWith("100:") || normalized.startsWith("::ffff:127.") || normalized.startsWith("::ffff:10.") || normalized.startsWith("::ffff:192.168.");
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

export function createSecureProviderFetch(resolve: DnsResolver = systemDnsResolver): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, { ...init, redirect: "manual" });
    const validated = await validateProviderUrl(request.url, resolve);
    const body = request.method === "GET" || request.method === "HEAD" ? undefined : Buffer.from(await request.arrayBuffer());
    return new Promise<Response>((resolveResponse, reject) => {
      const outgoing = httpsRequest(validated.url, {
        method: request.method,
        headers: Object.fromEntries(request.headers),
        signal: request.signal,
        lookup: (_hostname, _options, callback) => callback(null, validated.address, validated.family),
      }, (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        incoming.on("end", () => resolveResponse(new Response(Buffer.concat(chunks), { status: incoming.statusCode ?? 502, statusText: incoming.statusMessage, headers: incoming.headers as Record<string, string> })));
      });
      outgoing.on("error", reject);
      if (body) outgoing.write(body);
      outgoing.end();
    });
  };
}
