import test from "node:test";
import assert from "node:assert/strict";
import {ANTHROPIC_API_VERSION, ANTHROPIC_MESSAGES_ENDPOINT,
  AnthropicMessagesError, createAnthropicMessagesClient} from "./anthropic-messages.ts";
const model = "claude-haiku-5-5";
const apiKey = "sk-ant-NOT_A_REAL_KEY_1234567";
const messages = [
  {role: "system" as const, content: "Answer concisely."},
  {role: "user" as const, content: "What is 2+2?"},
];
const reply = (overrides: Record<string, unknown> = {}) => ({
  type: "message", role: "assistant", model, stop_reason: "end_turn",
  content: [{type: "text", text: "4"}],
  usage: {input_tokens: 20, output_tokens: 8,
    cache_creation_input_tokens: 6, cache_read_input_tokens: 9}, ...overrides,
});
const failure = (code: string) => (error: unknown): boolean =>
  error instanceof AnthropicMessagesError && error.code === code;
const json = (object: unknown): Response => new Response(JSON.stringify(object),
  {status: 200, headers: {"content-type": "application/json"}});

test("PER-1602 native Claude Messages v1 adapter pins HTTPS origin, headers and chat-only shape", async () => {
  let calls = 0;
  const client = createAnthropicMessagesClient({model, apiKey, fetchImpl: async (url, init) => {
    calls++;
    assert.equal(url, ANTHROPIC_MESSAGES_ENDPOINT);
    assert.equal(new URL(String(url)).origin, "https://api.anthropic.com");
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "error");
    assert.equal(init?.credentials, "omit");
    assert.equal(init?.cache, "no-store");
    assert.ok(init?.signal);
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers.authorization, `Bearer ${apiKey}`);
    assert.equal(headers["anthropic-version"], ANTHROPIC_API_VERSION);
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(Object.keys(body).sort(),
      ["model", "max_tokens", "system", "messages", "temperature", "stream"].sort());
    assert.equal(body.model, model);
    assert.equal(body.system, messages[0]!.content);
    assert.deepEqual(body.messages, [{role: "user", content: messages[1]!.content}]);
    assert.equal(body.stream, false);
    assert.ok(!("tools" in body));
    return json(reply());
  }});
  const value = await client.complete(messages, {usageEvidenceMode: true});
  assert.equal(value.content, "4");
  assert.equal(value.finishReason, "stop");
  assert.deepEqual(value.usage, {promptTokens: 35, completionTokens: 8});
  assert.equal(calls, 1);
});
test("PER-1602 provider HTTP errors never retry or expose response bodies", async () => {
  for (const code of [401, 403, 408, 429, 500, 503]) {
    let calls = 0;
    const client = createAnthropicMessagesClient({model, apiKey, fetchImpl: async () => {
      calls++;
      return new Response("SENSITIVE_UPSTREAM_CREDENTIAL", {status: code});
    }});
    await assert.rejects(() => client.complete(messages), error => {
      assert.ok(failure("anthropic_transport_http_failure")(error));
      assert.doesNotMatch(String(error), /SENSITIVE_UPSTREAM|sk-ant/);
      return true;
    });
    assert.equal(calls, 1);
  }
});
test("PER-1602 no tools, additional body, invalid roles or token/time limits reach egress", async () => {
  let calls = 0;
  const client = createAnthropicMessagesClient({model, apiKey,
    fetchImpl: async () => {calls++; throw new Error("Should not run");}});
  for (const opts of [
    {maxTokens: 401}, {maxTokens: 0}, {timeoutMs: 15_001},
    {temperature: 2}, {extraBody: {tools: [{type: "computer"}]}},
  ]) await assert.rejects(() => client.complete(messages, opts),
    failure("anthropic_transport_request_invalid"));
  await assert.rejects(() => client.complete([{role: "user", content: "hi"}]),
    failure("anthropic_transport_request_invalid"));
  assert.equal(calls, 0);
});
test("PER-1602 malformed tool responses and cache/accounting errors fail closed", async () => {
  for (const bad of [
    reply({type: "error"}), reply({model: "other"}),
    reply({content: [{type: "tool_use", id: "t", name: "shell"}], stop_reason: "tool_use"}),
    reply({content: [{type: "text", text: ""}]}),
    reply({content: [{type: "text", text: "4"}, {type: "tool_use", id: "t"}]}),
    reply({usage: {input_tokens: -1, output_tokens: 2}}),
    reply({usage: {input_tokens: 0, output_tokens: 0}}),
    reply({usage: {input_tokens: 1, output_tokens: 1, cache_read_input_tokens: -1}}),
    reply({content: [{type: "text", text: "x".repeat(3_001)}]}),
  ]) {
    const client = createAnthropicMessagesClient({model, apiKey,
      fetchImpl: async () => json(bad)});
    await assert.rejects(() => client.complete(messages),
      failure("anthropic_transport_response_invalid"));
  }
});
test("PER-1602 usage-first mode preserves true tokens but not invalid model text", async () => {
  for (const response of [
    reply({content: [{type: "tool_use", id: "tool", name: "shell"}], stop_reason: "tool_use"}),
    reply({content: [{type: "text", text: "partial"}], stop_reason: "max_tokens"}),
    reply({content: [{type: "text", text: ""}]}),
  ]) {
    const client = createAnthropicMessagesClient({model, apiKey,
      fetchImpl: async () => json(response)});
    const value = await client.complete(messages, {usageEvidenceMode: true});
    assert.equal(value.content, "");
    assert.deepEqual(value.usage, {promptTokens: 35, completionTokens: 8});
  }
});
test("PER-1602 malformed/bounded responses and network failures deny without retry", async () => {
  for (const output of ["{invalid", JSON.stringify(reply()) + " ".repeat(40_000)]) {
    const client = createAnthropicMessagesClient({model, apiKey,
      fetchImpl: async () => new Response(output, {status: 200})});
    await assert.rejects(() => client.complete(messages),
      failure("anthropic_transport_response_invalid"));
  }
  let calls = 0;
  const client = createAnthropicMessagesClient({model, apiKey, fetchImpl: async () => {
    calls++; throw new Error("SENSITIVE_NETWORK_INFO");
  }});
  await assert.rejects(() => client.complete(messages), error => {
    assert.ok(failure("anthropic_transport_request_failed")(error));
    assert.doesNotMatch(String(error), /SENSITIVE_NETWORK_INFO/);
    return true;
  });
  assert.equal(calls, 1);
});
