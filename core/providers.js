const SUPPORTED_TYPES = new Set(["tencentdb-agent-memory"]);
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const OVERSIZE_MESSAGE = "Provider response exceeded the 2 MiB safety limit.";

export function normalizeProviderConfig(input) {
  const type = String(input.type || "tencentdb-agent-memory").trim();
  if (!SUPPORTED_TYPES.has(type)) throw new Error(`Unsupported knowledge provider type: ${type}`);

  const knowledgeUrl = normalizeHttpUrl(
    input.knowledgeUrl || input.endpoints?.knowledge || "http://127.0.0.1:8424/v3",
    "Knowledge URL"
  );
  const coreValue = input.coreUrl ?? input.endpoints?.core;
  const coreUrl = coreValue ? normalizeHttpUrl(coreValue, "Core URL") : null;
  const serviceId = normalizeSegment(input.serviceId || "default", "Service ID");
  const knowledgeAuthEnv = normalizeEnvName(
    input.knowledgeAuthEnv ?? input.authEnv ?? input.auth?.knowledgeEnv ?? input.auth?.env ?? null
  );
  const coreAuthEnv = normalizeEnvName(input.coreAuthEnv ?? input.auth?.coreEnv ?? null);
  const timeoutMs = normalizeTimeout(input.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  return {
    type,
    enabled: input.enabled !== false,
    endpoints: { knowledge: knowledgeUrl, core: coreUrl },
    serviceId,
    auth: knowledgeAuthEnv || coreAuthEnv ? { knowledgeEnv: knowledgeAuthEnv, coreEnv: coreAuthEnv } : null,
    timeoutMs
  };
}

export function normalizeHttpUrl(value, label = "URL") {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error(`${label} must use http or https.`);
  if (url.username || url.password) throw new Error(`${label} must not contain credentials.`);
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

export function normalizeEnvName(value) {
  if (value === undefined || value === null || value === "") return null;
  const name = String(value).trim();
  if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) {
    throw new Error("Credential environment variable must use uppercase letters, numbers, and underscores.");
  }
  return name;
}

export function providerHeaders(provider, env = process.env, service = "knowledge") {
  const headers = {
    accept: "application/json",
    "content-type": "application/json",
    "x-tdai-service-id": provider.serviceId || "default"
  };
  if (service === "knowledge") {
    const name = provider.auth?.knowledgeEnv ?? provider.auth?.env;
    if (name) headers["x-tdai-user-key"] = readCredential(env, name);
  }
  if (service === "core") {
    const name = provider.auth?.coreEnv;
    if (name) headers.authorization = `Bearer ${readCredential(env, name)}`;
  }
  return headers;
}

// A provider that declares a credential variable but finds it unset must not
// quietly send an unauthenticated request: that either fails with a confusing
// server-side message or succeeds as an anonymous caller.
function readCredential(env, name) {
  const secret = env[name];
  if (!secret) {
    throw new Error(
      `Credential environment variable is not set: ${name}. Export it for this session; Workbench never stores its value.`
    );
  }
  return secret;
}

export async function listProviderTools(provider, knowledgeId, options = {}) {
  assertTencent(provider);
  return providerRequest(provider, "/tools/list", { knowledge_id: requiredText(knowledgeId, "Knowledge ID") }, options);
}

export async function callProviderTool(provider, knowledgeId, toolName, params = {}, options = {}) {
  assertTencent(provider);
  if (!params || typeof params !== "object" || Array.isArray(params)) throw new Error("Tool params must be a JSON object.");
  return providerRequest(
    provider,
    "/tools/call",
    {
      knowledge_id: requiredText(knowledgeId, "Knowledge ID"),
      tool_name: requiredText(toolName, "Tool name"),
      params
    },
    options
  );
}

export async function searchProvider(provider, knowledgeId, query, { limit = 10, ...options } = {}) {
  const safeLimit = Math.max(1, Math.min(50, Number.parseInt(limit, 10) || 10));
  return callProviderTool(
    provider,
    knowledgeId,
    "search",
    { query: requiredText(query, "Search query"), limit: safeLimit },
    options
  );
}

export async function recallCoreMemory(provider, query, { sessionKey, userId, ...options } = {}) {
  assertTencent(provider);
  if (provider.enabled === false) throw new Error(`Knowledge provider is disabled: ${provider.id}`);
  const base = provider.endpoints?.core;
  if (!base) throw new Error(`Core endpoint is missing for provider: ${provider.id}`);
  const body = {
    query: requiredText(query, "Recall query"),
    session_key: requiredText(sessionKey, "Session key")
  };
  if (userId) body.user_id = String(userId);
  return requestJson(
    `${base}/recall`,
    { method: "POST", headers: providerHeaders(provider, options.env, "core"), body: JSON.stringify(body) },
    provider,
    options
  );
}

export async function probeProvider(provider, options = {}) {
  assertTencent(provider);
  const targets = [
    { service: "knowledge", url: healthUrl(provider.endpoints.knowledge) },
    ...(provider.endpoints.core ? [{ service: "core", url: healthUrl(provider.endpoints.core) }] : [])
  ];
  const checks = await Promise.all(
    targets.map(async (target) => {
      const started = Date.now();
      try {
        await requestJson(
          target.url,
          { method: "GET", headers: providerHeaders(provider, options.env, target.service) },
          provider,
          options
        );
        return { service: target.service, ok: true, latencyMs: Date.now() - started, url: target.url };
      } catch (error) {
        return { service: target.service, ok: false, latencyMs: Date.now() - started, url: target.url, error: error.message };
      }
    })
  );
  return { providerId: provider.id, ok: checks.every((item) => item.ok), checks };
}

async function providerRequest(provider, route, body, options) {
  if (provider.enabled === false) throw new Error(`Knowledge provider is disabled: ${provider.id}`);
  const base = provider.endpoints?.knowledge;
  if (!base) throw new Error(`Knowledge endpoint is missing for provider: ${provider.id}`);
  return requestJson(
    `${base}${route}`,
    { method: "POST", headers: providerHeaders(provider, options.env), body: JSON.stringify(body) },
    provider,
    options
  );
}

async function requestJson(url, init, provider, { fetchFn = globalThis.fetch } = {}) {
  if (typeof fetchFn !== "function") throw new Error("This Node.js runtime does not provide fetch().");
  const timeoutMs = normalizeTimeout(provider.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchFn(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`Provider request timed out after ${timeoutMs} ms.`);
    throw new Error(`Provider request failed: ${error.message}`);
  } finally {
    clearTimeout(timer);
  }

  const text = await readBoundedText(response);
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`Provider returned non-JSON data (HTTP ${response.status}).`);
    }
  }
  if (!response.ok) {
    const message = payload?.message || payload?.error?.message || payload?.error || `HTTP ${response.status}`;
    throw new Error(`Provider rejected the request: ${String(message).slice(0, 500)}`);
  }
  if (payload?.success === false || payload?.code >= 400) {
    const message = payload?.message || payload?.error?.message || payload?.error || `code ${payload.code}`;
    throw new Error(`Provider rejected the request: ${String(message).slice(0, 500)}`);
  }
  return payload?.data ?? payload?.result ?? payload;
}

// The Content-Length pre-check only helps when the server declares one, so the
// cap is also enforced chunk by chunk: a chunked or mislabelled response is
// abandoned at the limit instead of being buffered into memory in full.
async function readBoundedText(response) {
  const declaredLength = Number(response.headers?.get?.("content-length") || 0);
  if (declaredLength > MAX_RESPONSE_BYTES) throw new Error(OVERSIZE_MESSAGE);

  const body = response.body;
  if (!body || typeof body.getReader !== "function") {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new Error(OVERSIZE_MESSAGE);
    return text;
  }

  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) throw new Error(OVERSIZE_MESSAGE);
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).toString("utf8");
}

function healthUrl(base) {
  const url = new URL(base);
  url.pathname = url.pathname.replace(/\/v3\/?$/, "").replace(/\/$/, "") + "/health";
  return url.toString();
}

function normalizeTimeout(value) {
  const timeout = Number.parseInt(value, 10);
  if (!Number.isFinite(timeout) || timeout < 250 || timeout > MAX_TIMEOUT_MS) {
    throw new Error(`Provider timeout must be between 250 and ${MAX_TIMEOUT_MS} milliseconds.`);
  }
  return timeout;
}

function normalizeSegment(value, label) {
  const text = requiredText(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(text)) {
    throw new Error(`${label} must use letters, numbers, dots, underscores, and hyphens.`);
  }
  return text;
}

function requiredText(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function assertTencent(provider) {
  if (provider.type !== "tencentdb-agent-memory") {
    throw new Error(`Unsupported knowledge provider type: ${provider.type}`);
  }
}
