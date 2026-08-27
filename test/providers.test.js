import assert from "node:assert/strict";
import test from "node:test";
import {
  callProviderTool,
  normalizeProviderConfig,
  providerHeaders,
  recallCoreMemory,
  searchProvider
} from "../core/providers.js";

test("provider configuration rejects embedded credentials and stores only an env name", () => {
  assert.throws(
    () => normalizeProviderConfig({ knowledgeUrl: "https://user:pass@example.test/v3" }),
    /must not contain credentials/
  );
  const provider = {
    id: "tencent",
    ...normalizeProviderConfig({
      knowledgeUrl: "https://memory.example.test/v3/",
      serviceId: "team-a",
      knowledgeAuthEnv: "AWB_TENCENT_USER_KEY",
      coreAuthEnv: "AWB_TENCENT_CORE_KEY"
    })
  };
  assert.equal(provider.endpoints.knowledge, "https://memory.example.test/v3");
  assert.equal(provider.auth.knowledgeEnv, "AWB_TENCENT_USER_KEY");
  assert.equal(provider.auth.coreEnv, "AWB_TENCENT_CORE_KEY");
  assert.equal("runtime-secret" in provider.auth, false);
  assert.equal(providerHeaders(provider, { AWB_TENCENT_USER_KEY: "runtime-secret" })["x-tdai-user-key"], "runtime-secret");
  assert.equal(
    providerHeaders(provider, { AWB_TENCENT_CORE_KEY: "core-secret" }, "core").authorization,
    "Bearer core-secret"
  );
});

test("MemoryCore recall uses query, session isolation, and Bearer auth", async () => {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ context: "bounded memory", memory_count: 2 }), { status: 200 });
  };
  const provider = {
    id: "tencent",
    ...normalizeProviderConfig({
      knowledgeUrl: "http://127.0.0.1:8424/v3",
      coreUrl: "http://127.0.0.1:8420/",
      serviceId: "team-a",
      coreAuthEnv: "AWB_TENCENT_CORE_KEY"
    })
  };
  const result = await recallCoreMemory(provider, "what did we decide", {
    sessionKey: "task-123",
    userId: "user-7",
    env: { AWB_TENCENT_CORE_KEY: "core-secret" },
    fetchFn
  });
  assert.equal(result.memory_count, 2);
  assert.equal(calls[0].url, "http://127.0.0.1:8420/recall");
  assert.equal(calls[0].init.headers.authorization, "Bearer core-secret");
  assert.deepEqual(calls[0].body, {
    query: "what did we decide",
    session_key: "task-123",
    user_id: "user-7"
  });
});

test("TencentDB provider uses the documented read-only tool call contract", async () => {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ data: { results: [{ ref: "page-1" }], count: 1 } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  const provider = {
    id: "tencent",
    ...normalizeProviderConfig({
      knowledgeUrl: "http://127.0.0.1:8424/v3",
      serviceId: "team-a",
      authEnv: "AWB_TENCENT_USER_KEY"
    })
  };

  const result = await searchProvider(provider, "wiki-123", "account validation", {
    limit: 8,
    env: { AWB_TENCENT_USER_KEY: "runtime-secret" },
    fetchFn
  });
  assert.equal(result.count, 1);
  assert.equal(calls[0].url, "http://127.0.0.1:8424/v3/tools/call");
  assert.equal(calls[0].init.headers["x-tdai-service-id"], "team-a");
  assert.equal(calls[0].init.headers["x-tdai-user-key"], "runtime-secret");
  assert.deepEqual(calls[0].body, {
    knowledge_id: "wiki-123",
    tool_name: "search",
    params: { query: "account validation", limit: 8 }
  });

  await callProviderTool(provider, "code-graph-9", "explore", { query: "checkout" }, {
    env: { AWB_TENCENT_USER_KEY: "runtime-secret" },
    fetchFn
  });
  assert.deepEqual(calls[1].body, {
    knowledge_id: "code-graph-9",
    tool_name: "explore",
    params: { query: "checkout" }
  });
});

test("a declared credential variable that is not exported fails before any request", async () => {
  const provider = {
    id: "tencent",
    ...normalizeProviderConfig({
      knowledgeUrl: "http://127.0.0.1:8424/v3",
      knowledgeAuthEnv: "AWB_TENCENT_USER_KEY"
    })
  };
  let called = false;
  const fetchFn = async () => {
    called = true;
    return new Response("{}", { status: 200 });
  };

  await assert.rejects(
    () => searchProvider(provider, "wiki-123", "anything", { env: {}, fetchFn }),
    /Credential environment variable is not set: AWB_TENCENT_USER_KEY/
  );
  assert.equal(called, false, "no unauthenticated request may be sent");
  assert.equal(providerHeaders(provider, { AWB_TENCENT_USER_KEY: "k" })["x-tdai-user-key"], "k");
});

test("an oversized provider response is abandoned instead of being buffered whole", async () => {
  const provider = { id: "tencent", ...normalizeProviderConfig({ knowledgeUrl: "http://127.0.0.1:8424/v3" }) };
  const megabyte = "x".repeat(1024 * 1024);
  let emitted = 0;

  // A chunked body with no Content-Length: the cap can only be enforced while
  // reading, and the stream must stop early rather than run to completion.
  const fetchFn = async () =>
    new Response(
      new ReadableStream({
        pull(controller) {
          emitted += 1;
          if (emitted > 16) {
            controller.close();
            return;
          }
          controller.enqueue(new TextEncoder().encode(megabyte));
        }
      }),
      { status: 200 }
    );

  await assert.rejects(
    () => searchProvider(provider, "wiki-123", "anything", { fetchFn }),
    /exceeded the 2 MiB safety limit/
  );
  assert.ok(emitted < 16, `stream should stop early, emitted ${emitted} chunks`);
});
