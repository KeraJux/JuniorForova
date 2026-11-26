import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp, extractAnswer } from "../server.js";

const fixture = {
  status: "completed",
  output: [
    {
      type: "message",
      role: "assistant",
      content: [
        {
          type: "output_text",
          text: "A researched answer. source",
          annotations: [
            {
              type: "url_citation",
              title: "Example source",
              url: "https://example.edu/research",
              start_index: 21,
              end_index: 27,
            },
          ],
        },
      ],
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
      env: { OPENAI_API_KEY: "test-server-secret" },
      fetchImpl: async (url, options) => {
        assert.equal(url, "https://api.openai.com/v1/responses");
        assert.equal(
          options.headers.Authorization,
          "Bearer test-server-secret",
        );
        const body = JSON.parse(options.body);
        assert.equal(body.store, false);
        assert.equal(body.tool_choice, "required");
        assert.deepEqual(body.tools, [{ type: "web_search" }]);
        assert.match(body.input, /High school/);
        return Response.json(fixture);
      },
    },
    async ({ root, post }) => {
      const config = await (await fetch(`${root}/api/config`)).text();
      assert.ok(!config.includes("test-server-secret"));
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
      env: { OPENAI_API_KEY: "test" },
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
        OPENAI_API_KEY: "test",
        WEB_SEARCH: "false",
        OPENAI_MODEL: "configured-model",
      },
      fetchImpl: async (_, options) => {
        const body = JSON.parse(options.body);
        assert.equal(body.model, "configured-model");
        assert.equal(body.tools, undefined);
        return Response.json({
          status: "completed",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [
                { type: "output_text", text: "Unverified model knowledge." },
              ],
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
  data.output[0].content[0].annotations.push(
    {
      type: "url_citation",
      title: "Duplicate",
      url: "https://example.edu/research",
    },
    {
      type: "url_citation",
      title: "Unsafe",
      url: "javascript:alert(1)",
      start_index: 0,
      end_index: 3,
    },
    { type: "url_citation", title: "Broken", url: "not-a-url" },
  );
  data.output[0].content.push({
    type: "output_text",
    text: "Invented source: https://not-a-real-source.example",
  });
  const result = extractAnswer(data);
  assert.equal(result.sources.length, 1);
  assert.equal(result.parts[0].citations.length, 1);
  assert.deepEqual(result.parts[1].citations, []);
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
      async () =>
        Response.json({ status: "incomplete", output: fixture.output }),
      502,
      /incomplete/,
    ],
    [
      async () => Response.json({ status: "completed", output: [] }),
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
      { env: { OPENAI_API_KEY: "test" }, fetchImpl: provider },
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
      env: { OPENAI_API_KEY: "test" },
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

test("subject explanations teach without claiming live research", async () => {
  await withApp(
    {
      env: { OPENAI_API_KEY: "test" },
      fetchImpl: async (_, options) => {
        const body = JSON.parse(options.body);
        assert.equal(body.tools, undefined);
        assert.match(body.instructions, /worked example/);
        assert.match(body.input, /Subject: Mathematics/);
        return Response.json({
          status: "completed",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [
                { type: "output_text", text: "Test fixture explanation." },
              ],
            },
          ],
        });
      },
    },
    async ({ post }) => {
      const response = await post({
        ...valid,
        mode: "explain",
        subject: "Mathematics",
      });
      assert.equal(response.status, 200);
      const answer = await response.json();
      assert.equal(answer.webSearch, false);
      assert.equal(answer.mode, "explain");
      assert.equal(answer.subject, "Mathematics");
      assert.deepEqual(answer.sources, []);
    },
  );
});

test("only explicitly enabled Android origin gets CORS access; invalid modes are rejected", async () => {
  for (const enabled of [false, true]) {
    await withApp(
      { env: { ...(enabled ? { APP_ORIGIN: "https://localhost" } : {}) } },
      async ({ root, post }) => {
        const origin = "https://localhost";
        const preflight = await fetch(`${root}/api/research`, {
          method: "OPTIONS",
          headers: {
            Origin: origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Content-Type",
          },
        });
        assert.equal(preflight.status, enabled ? 204 : 404);
        assert.equal(
          preflight.headers.get("access-control-allow-origin"),
          enabled ? origin : null,
        );
        const response = await post(valid, { Origin: origin });
        assert.equal(response.status, enabled ? 503 : 403);
        const config = await fetch(`${root}/api/config`, {
          headers: { Origin: origin },
        });
        assert.equal(
          config.headers.get("access-control-allow-origin"),
          enabled ? origin : null,
        );
        const bad = await post(valid, { Origin: "https://attacker.example" });
        assert.equal(bad.status, 403);
        assert.equal(bad.headers.get("access-control-allow-origin"), null);
        for (const input of [
          { ...valid, mode: "invalid" },
          { ...valid, subject: "Injected subject" },
        ])
          assert.equal((await post(input)).status, 400);
      },
    );
  }
});

test("OpenRouter research uses its own key and web plugin; citations come only from metadata", async () => {
  await withApp(
    {
      env: {
        AI_PROVIDER: "openrouter",
        OPENAI_API_KEY: "must-not-use-openai-key",
        OPENROUTER_API_KEY: "test-openrouter-secret",
        OPENROUTER_MODEL: "configured/router-model",
      },
      fetchImpl: async (url, options) => {
        assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
        assert.equal(
          options.headers.Authorization,
          "Bearer test-openrouter-secret",
        );
        const body = JSON.parse(options.body);
        assert.equal(body.model, "configured/router-model");
        assert.equal(body.max_tokens, 5000);
        assert.deepEqual(body.plugins, [
          { id: "web", engine: "exa", max_results: 5 },
        ]);
        assert.match(body.messages[0].content, /Never invent a source/);
        assert.match(body.messages[1].content, /Study level: High school/);
        return Response.json({
          choices: [
            {
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "A researched answer. source https://invented.example",
                annotations: [
                  {
                    type: "url_citation",
                    url_citation: fixture.output[0].content[0].annotations[0],
                  },
                  {
                    type: "url_citation",
                    url_citation: { url: "javascript:alert(1)" },
                  },
                  { type: "url_citation" },
                ],
              },
            },
          ],
        });
      },
    },
    async ({ root, post }) => {
      assert.deepEqual(await (await fetch(`${root}/api/config`)).json(), {
        configured: true,
        webSearch: true,
      });
      const response = await post();
      assert.equal(response.status, 200);
      const answer = await response.json();
      assert.equal(answer.webSearch, true);
      assert.deepEqual(answer.sources, [
        { title: "Example source", url: "https://example.edu/research" },
      ]);
      assert.deepEqual(answer.parts[0].citations, [
        { start: 21, end: 27, source: 0 },
      ]);
      assert.ok(!JSON.stringify(answer).includes("test-openrouter-secret"));
      assert.equal((await fetch(`${root}/.env`)).status, 404);
    },
  );
});

test("OpenRouter explanations and disabled research do not enable search", async () => {
  for (const mode of ["explain", "research"]) {
    await withApp(
      {
        env: {
          AI_PROVIDER: "openrouter",
          OPENROUTER_API_KEY: "test",
          ...(mode === "research" ? { WEB_SEARCH: "false" } : {}),
        },
        fetchImpl: async (_, options) => {
          const body = JSON.parse(options.body);
          assert.equal(body.model, "openai/gpt-4.1-mini");
          assert.equal(body.plugins, undefined);
          if (mode === "explain")
            assert.match(
              body.messages[0].content,
              /without live source verification/,
            );
          return Response.json({
            choices: [
              {
                finish_reason: "stop",
                message: {
                  content:
                    "Fixture model knowledge with https://invented.example",
                },
              },
            ],
          });
        },
      },
      async ({ post }) => {
        const response = await post({ ...valid, mode });
        assert.equal(response.status, 200);
        const answer = await response.json();
        assert.equal(answer.webSearch, false);
        assert.deepEqual(answer.sources, []);
      },
    );
  }
});

test("OpenRouter missing key, rejected key, insufficient credits and incomplete results are honest", async () => {
  await withApp(
    {
      env: { AI_PROVIDER: "openrouter", OPENAI_API_KEY: "wrong-provider" },
      fetchImpl: () => assert.fail("must not call provider"),
    },
    async ({ post, root }) => {
      assert.equal(
        (await (await fetch(`${root}/api/config`)).json()).configured,
        false,
      );
      const response = await post();
      assert.equal(response.status, 503);
      assert.match((await response.json()).error, /OPENROUTER_API_KEY/);
    },
  );
  for (const [providerResponse, pattern] of [
    [
      new Response("private provider details", { status: 401 }),
      /OPENROUTER_API_KEY/,
    ],
    [
      new Response("private provider details", { status: 402 }),
      /needs credits/,
    ],
    [
      Response.json({
        choices: [
          { finish_reason: "length", message: { content: "Truncated" } },
        ],
      }),
      /incomplete/,
    ],
    [
      Response.json({ error: { message: "private provider details" } }),
      /incomplete/,
    ],
    [
      Response.json({
        choices: [{ finish_reason: "stop", message: { content: null } }],
      }),
      /No answer/,
    ],
  ]) {
    await withApp(
      {
        env: { AI_PROVIDER: "openrouter", OPENROUTER_API_KEY: "test" },
        fetchImpl: async () => providerResponse,
      },
      async ({ post }) => {
        const response = await post();
        assert.equal(response.status, 502);
        const body = await response.text();
        assert.match(body, pattern);
        assert.ok(!body.includes("private provider details"));
      },
    );
  }
});
