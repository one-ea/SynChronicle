# Task 11 Report

## Status

Implemented the Task 11 credential-encryption brief and retained the reusable model configuration delivered in the preceding commit.

## Credential Security

- AES-256-GCM envelope encryption generates a random data key per write, encrypts payload and wrapped key independently, and authenticates `userId`, `credentialId`, and Provider as AAD.
- Versioned project credential keys load from `PROJECT_CREDENTIAL_MASTER_KEYS` and `PROJECT_CREDENTIAL_MASTER_KEY_VERSION`. Missing, malformed, and unavailable versions produce explicit credential crypto errors.
- Credential create, metadata list, replace, disable, revoke, and resolve operations enforce tenant scope and state transitions. Replace rotates the data key.
- Database mutations and audit events commit in one transaction. Concurrent replace/revoke operations lock the credential row.
- API responses return owned opaque credential IDs and metadata only. Plaintext, envelopes, ciphertext, and wrapped keys stay out of responses.
- Recursive redaction covers nested objects, arrays, headers, URL query credentials, common secret fields, credential IDs, and Error causes.
- Custom Provider base URLs require HTTPS and a Provider-specific hostname allowlist match. Built-in rules cover current official API domains; administrators may add exact hostnames or narrowly scoped subdomain suffixes through `PROJECT_PROVIDER_ALLOWED_HOSTS`.
- DNS/IP validation remains defense-in-depth after hostname authorization. It normalizes IPv4-mapped IPv6, applies the IPv4 CIDR policy to mapped addresses, permits only IPv6 global unicast, and blocks IANA special-purpose, IPv4-compatible, NAT64, Teredo, 6to4, documentation, private, reserved, multicast, and metadata ranges. Every request resolves again and pins the validated address into the TLS connection.
- The pinned HTTPS transport enforces TLS connection, response-header, overall, and per-read timeouts plus a bounded response body. Timeout and size failures use stable transport error codes and destroy the active stream/request. Redirect following is disabled.
- Credential resolution writes success and rejection audits with credential ID, Provider, run ID, result, and a reason classified as lookup/state, decrypt, payload, or URL validation failure. Resolution audit failure is fail-closed and remains the surfaced error, so a model call cannot proceed without its security audit.

## Provider And Worker

- Provider credential routes use strict Zod schemas, authenticated requests, global mutation-origin checks, and per-user mutation rate limiting.
- Worker models carrying a credential ID resolve it immediately before each Provider `doGenerate` or `doStream` call and release the in-memory lease in `finally`.
- User credential calls override configured Provider API keys for that call. Platform model calls retain platform Provider configuration.
- Actual Provider/model attribution remains supplied by the AI SDK model and failover layers.
- Credential lifecycle conflicts return stable error codes and HTTP 409 responses; unsafe URLs return a stable HTTP 400 code.

## Model Configuration Corrections

- `temperature` and `maxTokens` flow from versioned per-Agent snapshots into `generateText` and `streamText` as live generation options.
- Model-switch commands preserve credential ID and generation parameters through durable delivery, Host persistence, recovery, and safe-boundary application.
- Provider selectors filter model and credential choices by Provider. Server validation checks tenant credential ownership and Provider/model linkage.
- Active model-set changes use a tenant advisory lock plus a partial unique database index, preserving one active version per tenant.
- Queued model commands continue to return explicit safe-boundary status feedback.
- Reflection reviewers consume the live reviewer role temperature and max-token settings.
- Tenant-scoped command status lookup is available by command ID. Worker acknowledgement/failure writes `command.applied` or `command.error` events and publishes a WS wakeup; the UI correlates these events, renders applied/failed state, and offers model-switch retry after failure.
- Pending model-switch command IDs persist by project and run in session storage. Page refresh and WebSocket reconnection trigger status recovery, while terminal status clears the persisted command.
- Session storage access is wrapped in safe get/set/remove helpers. Browsers that throw `SecurityError` continue without command persistence.

## Final Security Closure

- Credential create and replace validate the submitted `baseUrl` against the credential Provider. Credential resolution repeats the same Provider-host validation immediately before every model call.
- Custom transports repeat Provider-host authorization before DNS resolution, preventing user-controlled egress to arbitrary public targets, including NAT64 translation targets.
- `PROJECT_PROVIDER_ALLOWED_HOSTS` uses a strict JSON provider-to-hosts map. Provider names must be lowercase identifiers; rules accept exact hostnames or dot-prefixed suffixes with at least three labels. URLs, IP literals, localhost, wildcard syntax, malformed labels, and broad suffixes are rejected at startup.
- Web and Worker load the same project host policy. Platform-configured custom Provider URLs and user credential URLs share the same request-time enforcement.
- No Agent LLM environment variables are read or copied. Documentation contains only the project-owned `PROJECT_PROVIDER_ALLOWED_HOSTS` placeholder and example hostnames.

## TDD

- RED/GREEN cycles covered envelope randomness and AAD, key registry errors, recursive redaction, Provider-aware hostname authorization, strict administrator policy parsing, SSRF address classes and rebinding, IANA special-purpose ranges, mapped/translated IPv6 ranges, TLS/header/body transport limits, CredentialService state transitions and resolution audit classification, metadata-only routes, stable errors, rate limiting, call-scoped Worker resolution, switch parameter retention, reviewer parameters, command status API, WS command projection, pending-command refresh/reconnect recovery, and blocked session storage.
- PostgreSQL-conditional coverage covers cross-tenant resolution, plaintext serialization, concurrent replace/revoke, AAD tampering, and concurrent active model-set selection.

## Verification

- Security/credential/Provider/Worker/Web target suite: 158 passed, 4 PostgreSQL-conditional skipped.
- Full Vitest suite: 528 passed, 48 PostgreSQL-conditional skipped.
- TypeScript typecheck: passed.
- Production build: passed.
- Drizzle check: passed.
- Drizzle generate: no additional schema changes.
- Git diff check: passed.

## Concerns

- JavaScript strings cannot be deterministically zeroed by the runtime. The implementation minimizes lifetime, clears mutable lease references, and scopes plaintext to credential resolution and the immediate Provider call.
- PostgreSQL-conditional tests require `TEST_DATABASE_URL`; skipped counts are reported from the final gate.
- DNS pinning is implemented for custom base URLs through the Node HTTPS transport. SDK-owned official default transports remain under the upstream SDK's endpoint policy.
- Additional subdomain suffix rules intentionally require at least three labels. Administrators can use exact hostname entries for shorter domains.
