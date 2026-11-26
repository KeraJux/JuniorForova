import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp, extractAnswer } from "../server.js";

const fixture = {
  choices: [
    {
      finish_reason: "stop",
      message: {
        role: "assistant",
        content: "A researched answer. source",
        annotations: [
          {
            type: "url_citation",
            url_citation: {
              title: "Example source",
              url: "https://example.edu/research",
              start_index: 21,
              end_index: 27,
            },
          },
        ],
      },
    },
  ],
};
const valid = { question: "Why is the sky blue?", level: "High school" };
async function withApp(options, fn) {
  const server = createApp(options);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const root = `http://127.0.0.1:${server.address().port}`;
  const post = (input = valid, headers = {}) =>
    fetch(`${root}/api/research`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(input),
    });
  try {
    await fn({ root, post });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("missing key is actionable; config and static files never expose secrets", async () => {
  await withApp({ env: {} }, async ({ root, post }) => {
    const response = await post();
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "NOT_CONFIGURED");
    assert.deepEqual(await (await fetch(`${root}/api/config`)).json(), {
      configured: false,
      webSearch: true,
    });
    assert.equal((await fetch(`${root}/.env`)).status, 404);
    assert.equal((await fetch(`${root}/server.js`)).status, 404);
    const home = await fetch(root);
    assert.equal(home.status, 200);
    assert.match(
      home.headers.get("content-security-policy"),
      /frame-ancestors 'none'/,
    );
  });
});

test("valid questions call real API contract with server secret and only citation metadata", async () => {
  await withApp(
    {
      env: { OPENROUTER_API_KEY: "  test-server-secret  " },
      fetchImpl: async (url, options) => {
        assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
        assert.equal(
          options.headers.Authorization,
          "Bearer test-server-secret",
        );
        const body = JSON.parse(options.body);
        assert.equal(body.model, "openai/gpt-4.1-mini");
        assert.equal(body.stream, false);
        assert.equal(body.max_tokens, 5000);
        assert.deepEqual(body.plugins, [{ id: "web", max_results: 5 }]);
        assert.equal(body.messages[0].role, "system");
        assert.deepEqual(body.messages[1], {
          role: "user",
          content: `Study level: High school\nResearch question: ${valid.question}`,
        });
        return Response.json(fixture);
      },
    },
    async ({ root, post }) => {
      const config = await (await fetch(`${root}/api/config`)).text();
      assert.ok(!config.includes("test-server-secret"));
      for (const path of ["/", "/app.js", "/styles.css", "/favicon.svg"]) {
        const asset = await (await fetch(`${root}${path}`)).text();
        assert.ok(!asset.includes("test-server-secret"));
      }
      const response = await post();
      assert.equal(response.status, 200);
      const answer = await response.json();
      assert.equal(answer.sources[0].url, "https://example.edu/research");
      assert.deepEqual(answer.parts[0].citations[0], {
        start: 21,
        end: 27,
        source: 0,
      });
      assert.ok(!JSON.stringify(answer).includes("test-server-secret"));
    },
  );
});

test("validation, input bounds, and cross-origin protection reject before provider calls", async () => {
  await withApp(
    {
      env: { OPENROUTER_API_KEY: "test" },
      fetchImpl: () => assert.fail("must not call provider"),
    },
    async ({ post, root }) => {
      for (const input of [
        null,
        {},
        { ...valid, question: "tiny" },
        { ...valid, question: "a".repeat(2001) },
        { ...valid, level: "invalid" },
      ])
        assert.equal((await post(input)).status, 400);
      assert.equal(
        (await post({ ...valid, question: "a".repeat(17000) })).status,
        413,
      );
      assert.equal(
        (await post(valid, { Origin: "https://attacker.example" })).status,
        403,
      );
      assert.equal((await post(valid, { Origin: "null" })).status, 403);
      assert.equal(
        (
          await fetch(`${root}/api/research`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{",
          })
        ).status,
        400,
      );
      assert.equal(
        (await fetch(`${root}/api/research`, { method: "POST", body: "{}" }))
          .status,
        415,
      );
    },
  );
});

test("search-disabled answers do not claim sources or send search tools", async () => {
  await withApp(
    {
      env: {
        OPENROUTER_API_KEY: "test",
        WEB_SEARCH: "false",
        OPENROUTER_MODEL: "configured-model",
      },
      fetchImpl: async (_, options) => {
        const body = JSON.parse(options.body);
        assert.equal(body.model, "configured-model");
        assert.equal(body.plugins, undefined);
        return Response.json({
          choices: [
            {
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "Unverified model knowledge.",
              },
            },
          ],
        });
      },
    },
    async ({ post }) => {
      const answer = await (await post()).json();
      assert.equal(answer.webSearch, false);
      assert.deepEqual(answer.sources, []);
    },
  );
});

test("citations deduplicate; unsafe and fabricated source links are not promoted", () => {
  const data = structuredClone(fixture);
  data.choices[0].message.annotations.push(
    {
      type: "url_citation",
      url_citation: { title: "Duplicate", url: "https://example.edu/research" },
    },
    {
      type: "url_citation",
      url_citation: {
        title: "Unsafe",
        url: "javascript:alert(1)",
        start_index: 0,
        end_index: 3,
      },
    },
    {
      type: "url_citation",
      url_citation: { title: "Broken", url: "not-a-url" },
    },
  );
  data.choices[0].message.content +=
    " Invented source: https://not-a-real-source.example";
  const result = extractAnswer(data);
  assert.equal(result.sources.length, 1);
  assert.equal(result.parts[0].citations.length, 1);
  assert.equal(result.parts.length, 1);
});

test("provider errors, incomplete output and network failure are honest and sanitized", async () => {
  for (const [provider, status, pattern] of [
    [
      async () => new Response("secret-provider-detail", { status: 401 }),
      502,
      /rejected the server API key/,
    ],
    [async () => new Response("", { status: 429 }), 429, /usage limit/],
    [
      async () => new Response("secret-provider-detail", { status: 402 }),
      502,
      /could not complete/,
    ],
    [
      async () => new Response("secret-provider-detail", { status: 500 }),
      502,
      /could not complete/,
    ],
    [
      async () =>
        Response.json({ error: { message: "secret-provider-detail" } }),
      502,
      /incomplete/,
    ],
    [async () => Response.json({ choices: [] }), 502, /incomplete/],
    [async () => new Response("invalid-json"), 502, /could not be reached/],
    [
      async () => {
        throw new DOMException("secret-provider-detail", "TimeoutError");
      },
      502,
      /took too long/,
    ],
    [
      async () =>
        Response.json({
          choices: [{ ...fixture.choices[0], finish_reason: "length" }],
        }),
      502,
      /incomplete/,
    ],
    [
      async () =>
        Response.json({
          choices: [
            {
              finish_reason: "stop",
              message: { role: "assistant", content: "" },
            },
          ],
        }),
      502,
      /No answer/,
    ],
    [
      async () => {
        throw new Error("secret-provider-detail");
      },
      502,
      /could not be reached/,
    ],
  ]) {
    await withApp(
      { env: { OPENROUTER_API_KEY: "test" }, fetchImpl: provider },
      async ({ post }) => {
        const response = await post();
        assert.equal(response.status, status);
        const body = await response.text();
        assert.match(body, pattern);
        assert.ok(!body.includes("secret-provider-detail"));
      },
    );
  }
});

test("global request budget bounds repeated provider usage", async () => {
  let calls = 0;
  await withApp(
    {
      env: { OPENROUTER_API_KEY: "test" },
      fetchImpl: async () => {
        calls++;
        return Response.json(fixture);
      },
    },
    async ({ post }) => {
      for (let i = 0; i < 12; i++) assert.equal((await post()).status, 200);
      assert.equal((await post()).status, 429);
      assert.equal(calls, 12);
    },
  );
});

test("blank or legacy provider keys cannot enable OpenRouter", async () => {
  for (const env of [
    { OPENROUTER_API_KEY: "   " },
    { OPENAI_API_KEY: "unused-legacy-test-key" },
  ]) {
    await withApp(
      { env, fetchImpl: () => assert.fail("must not call provider") },
      async ({ root, post }) => {
        assert.equal(
          (await (await fetch(`${root}/api/config`)).json()).configured,
          false,
        );
        assert.equal((await post()).status, 503);
      },
    );
  }
});
