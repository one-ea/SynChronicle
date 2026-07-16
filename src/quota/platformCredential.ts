const environmentReference = /^env:([A-Z][A-Z0-9_]{0,127})$/;
const encryptedReference = /^credential:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

export type PlatformCredentialSource = "environment" | "encrypted";

export function platformCredentialSource(reference: string): PlatformCredentialSource {
  if (environmentReference.test(reference)) return "environment";
  if (encryptedReference.test(reference)) return "encrypted";
  throw new Error("invalid platform credential reference");
}

export async function resolvePlatformCredential(input: { reference: string; provider: string; environment: Record<string, string | undefined>; credentialOwnerId?: string; credentials: { resolve(userId: string, credentialId: string, context: { runId: string }): Promise<{ provider: string; apiKey: string; baseUrl?: string } | null> }; runId: string }): Promise<{ apiKey: string; baseUrl?: string; source: PlatformCredentialSource; release(): void }> {
  const environmentMatch = input.reference.match(environmentReference);
  if (environmentMatch) {
    const value = input.environment[environmentMatch[1]!];
    if (!value) throw new Error("platform environment credential is unavailable");
    const lease = { apiKey: value, source: "environment" as const, release() { lease.apiKey = ""; } };
    return lease;
  }
  const encryptedMatch = input.reference.match(encryptedReference);
  if (!encryptedMatch || !input.credentialOwnerId) throw new Error("platform encrypted credential metadata is invalid");
  const secret = await input.credentials.resolve(input.credentialOwnerId, encryptedMatch[1]!, { runId: input.runId });
  if (!secret || secret.provider !== input.provider) throw new Error("platform encrypted credential is unavailable for this provider");
  const lease = { apiKey: secret.apiKey, baseUrl: secret.baseUrl, source: "encrypted" as const, release() { lease.apiKey = ""; lease.baseUrl = undefined; secret.apiKey = ""; secret.baseUrl = undefined; } };
  return lease;
}

export function platformCredentialModel(input: { provider: string; model: string; runId: string; base: Record<string, unknown>; load(): Promise<{ credentialReference: string; metadata: unknown } | undefined>; environment: Record<string, string | undefined>; credentials: Parameters<typeof resolvePlatformCredential>[0]["credentials"]; factory(provider: string, config: Record<string, unknown>, model: string): unknown }) {
  const invoke = async (method: "doGenerate" | "doStream", options: unknown) => {
    const configured = await input.load();
    if (!configured) throw new Error("platform model is unavailable");
    const metadata = configured.metadata && typeof configured.metadata === "object" ? configured.metadata as Record<string, unknown> : {};
    const lease = await resolvePlatformCredential({ reference: configured.credentialReference, provider: input.provider, environment: input.environment, credentialOwnerId: typeof metadata.credentialOwnerId === "string" ? metadata.credentialOwnerId : undefined, credentials: input.credentials, runId: input.runId });
    try {
      const instance = input.factory(input.provider, { ...input.base, api_key: lease.apiKey, ...(lease.baseUrl ? { base_url: lease.baseUrl } : {}) }, input.model) as Record<string, (value: unknown) => Promise<unknown>>;
      const operation = instance[method];
      if (!operation) throw new Error(`provider model does not implement ${method}`);
      return await operation.call(instance, options);
    } finally {
      lease.release();
    }
  };
  return { specificationVersion: "v2", provider: input.provider, modelId: input.model, supportedUrls: {}, doGenerate: (options: unknown) => invoke("doGenerate", options), doStream: (options: unknown) => invoke("doStream", options) };
}
