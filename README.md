# Folio

A small school research workspace: ask questions at your study level, read AI-assisted explanations, follow source citations, and save research briefs in a browser-local library. Built with Node.js and plain HTML/CSS/JavaScript; no runtime dependencies or build step.

## Run locally

Requires Node.js 22 or newer (Node 24 recommended).

```sh
cp .env.example .env
# Open .env in a local editor and privately set OPENAI_API_KEY to a new key.
npm start
```

Open http://127.0.0.1:3000. Without a key, the UI works for exploring prompts and shows configuration guidance; it does not produce demo answers. Restart the server after changing `.env`.

Keep `.env` in the server project root, beside `package.json`, outside `public/`. Both `npm start` and `npm run dev` use Node's built-in environment-file loading; no additional package is needed. An existing process environment variable takes precedence over `.env`. Other variants such as `.env.local` are ignored by Git but are not loaded automatically. Run the npm commands from this project directory.

If a key was exposed in chat or elsewhere, revoke it in your OpenAI account and create a replacement privately. Do not retrieve, reuse, or paste the exposed key. Enter the replacement only in the server's private `.env` (or your host's server environment/secret settings). Keep `.env.example` blank for `OPENAI_API_KEY`. Never put a key in source, shell commands/history, logs, screenshots, browser/mobile code, or client build variables. Git ignores `.env`, its variants, and named environment files such as `production.env`; do not force-add them. Only the server uses the key, and `/api/config` reports a configuration boolean without returning its value.

| Server variable  | Default      | Purpose                                                                     |
| ---------------- | ------------ | --------------------------------------------------------------------------- |
| `OPENAI_API_KEY` | unset        | Required for answers; stored only on the server                             |
| `OPENAI_MODEL`   | `gpt-5-mini` | Responses API model with hosted web search support; requires account access |
| `WEB_SEARCH`     | `true`       | Set exactly `false` to disable live web research                            |
| `HOST`           | `127.0.0.1`  | Local-only by default                                                       |
| `PORT`           | `3000`       | HTTP listening port                                                         |

The server calls the [OpenAI Responses API with hosted web search](https://developers.openai.com/api/docs/guides/tools-web-search). Web research requires no separate search service/key, but both model and search calls can incur provider charges. With search enabled, the request requires tool use. Source cards and inline links come exclusively from provider `url_citation` annotations, never model-generated source lists. Answers without citations are explicitly marked unverified. Source availability and quality depend on the provider; students should open and evaluate them. Search-disabled answers are based on model knowledge. The server does not fetch URLs suggested by a user or model.

Questions are sent to OpenAI with `store: false`; provider data policies still apply. The app does not log questions or persist them on the server. Up to 40 saved briefs (including source links) stay in localStorage on the current browser and can be removed in My library. Clearing browser data removes them. There are no accounts or cross-device sync. Follow-up prompts include the original question but do not automatically transmit prior answers as conversation history. Avoid personal information in questions.

## Checks

```sh
npm run check
npm test
```

Tests use explicit provider fixtures, not real AI calls or credentials. They cover request validation, missing configuration, provider failures/timeouts/incomplete answers, citation extraction and unsafe URLs, search configuration, secret isolation, and cross-origin protection.

## Hosting

This is a local-first minimal app. The API has a global limit of 12 requests/minute and 3 concurrent requests per server process, input/output bounds, a 90-second provider timeout, and browser origin checks. **Before exposing it publicly, put it behind authentication and HTTPS and add per-user quotas / provider spend limits.** There is no built-in user authentication; the global limiter is not a substitute. Multiple server instances do not share limits. Set `HOST=0.0.0.0` only when your deployment needs it. Keep `.env` and API keys out of version control and browser code. Only explicit public assets are served, and provider error details are not forwarded to the browser.
