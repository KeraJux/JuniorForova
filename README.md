# Folio

A small school research workspace: ask questions at your study level, read AI-assisted explanations, follow source citations, and save research briefs in a browser-local library. Built with Node.js and plain HTML/CSS/JavaScript; no runtime dependencies or build step.

## Run locally

Requires Node.js 22 or newer (Node 24 recommended).

```sh
cp .env.example .env
# Edit .env and set OPENROUTER_API_KEY to a newly generated OpenRouter API key.
npm start
```

Open http://127.0.0.1:3000. Without a key, the UI works for exploring prompts and shows configuration guidance; it does not produce demo answers. Restart the server after changing `.env`.

| Server variable      | Default               | Purpose                                              |
| -------------------- | --------------------- | ---------------------------------------------------- |
| `OPENROUTER_API_KEY` | unset                 | Required for answers; stored only on the server      |
| `OPENROUTER_MODEL`   | `openai/gpt-4.1-mini` | OpenRouter model ID; requires account access         |
| `WEB_SEARCH`         | `true`                | Set exactly `false` to disable the web search plugin |
| `HOST`               | `127.0.0.1`           | Local-only by default                                |
| `PORT`               | `3000`                | HTTP listening port                                  |

The server calls [OpenRouter Chat Completions](https://openrouter.ai/docs/api-reference/chat-completion). With search enabled, it adds OpenRouter's [web search plugin](https://openrouter.ai/docs/guides/features/plugins/web-search); no separate search key is needed, but both model and search calls can incur provider charges. Source cards and inline links come exclusively from provider `url_citation` annotations, never model-generated source lists. Answers without citations are explicitly marked unverified. Source availability and quality depend on the provider; students should open and evaluate them. Search-disabled answers are based on model knowledge. The server does not fetch URLs suggested by a user or model.

The key previously shared in chat is exposed: revoke it in the provider dashboard and create a replacement at https://openrouter.ai/settings/keys. Do not reuse it or paste a replacement into chat. Put the new key only in the server's ignored `.env` file (locally) or your hosting platform's secret/environment settings (deployment). Set `OPENROUTER_MODEL` to a model available to that OpenRouter account, ensure sufficient credits, and restart the server. Never put the key in browser code, localStorage, public/build-prefixed variables, screenshots, or version control. `.env.example` contains names and defaults only. The app no longer reads the former provider variables.

Questions and study levels are sent to OpenRouter and its selected model/search providers; their data retention and privacy policies apply. The app does not log questions or persist them on the server. Up to 40 saved briefs (including source links) stay in localStorage on the current browser and can be removed in My library. Clearing browser data removes them. There are no accounts or cross-device sync. Follow-up prompts include the original question but do not automatically transmit prior answers as conversation history. Avoid personal information in questions.

## Checks

```sh
npm run check
npm test
```

Tests use explicit provider fixtures, not real AI calls or credentials. They cover request validation, missing configuration, provider failures/timeouts/incomplete answers, citation extraction and unsafe URLs, search configuration, secret isolation, and cross-origin protection.

## Hosting

This is a local-first minimal app. The API has a global limit of 12 requests/minute and 3 concurrent requests per server process, input/output bounds, a 90-second provider timeout, and browser origin checks. **Before exposing it publicly, put it behind authentication and HTTPS and add per-user quotas / provider spend limits.** There is no built-in user authentication; the global limiter is not a substitute. Multiple server instances do not share limits. Set `HOST=0.0.0.0` only when your deployment needs it. Keep `.env` and API keys out of version control and browser code. Only explicit public assets are served, and provider error details are not forwarded to the browser.
