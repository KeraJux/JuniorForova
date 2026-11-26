# Ungai Study

An Android study and research app for Ungai Seventh-day Adventist Secondary School, built on the existing Folio web workspace. The Android project uses Capacitor to bundle the shared HTML/CSS/JavaScript interface locally. The Node.js backend keeps AI credentials off the device. This is a review build, not a production deployment.

- **Subject explanations:** choose a school subject and study level; receive step-by-step explanations, examples, and practice questions. These use model knowledge and are explicitly marked as having no live source verification.
- **Research:** ask questions with hosted web search. Inline citations and source cards come only from provider `url_citation` annotations, never generated URL lists. Missing citations are marked unverified. Students should open and evaluate the sources.
- **Saved study notes:** create, edit, and delete personal notes without AI or internet. Save AI answers with their citations separately. Existing Folio research libraries are preserved.

No mock answers are shown. Without credentials or an Android backend URL, notes and topic prompts work while AI shows setup guidance. No paid provider requests are made by the tests.

## Run the web workspace and backend

Requires Node.js 22+ (24 recommended).

```sh
npm ci
cp .env.example .env
# Set the provider and its funded server-side API key in .env (see below).
npm start
```

Open http://127.0.0.1:3000. Restart the server after changing `.env`.

| Server variable      | Default               | Purpose                                                                              |
| -------------------- | --------------------- | ------------------------------------------------------------------------------------ |
| `AI_PROVIDER`        | `openai`              | `openai` or `openrouter`; selects the API and corresponding server key               |
| `OPENAI_API_KEY`     | unset                 | Required when `AI_PROVIDER=openai`; server only                                      |
| `OPENAI_MODEL`       | `gpt-5-mini`          | Responses API model; account must have model and web search access                   |
| `OPENROUTER_API_KEY` | unset                 | Required when `AI_PROVIDER=openrouter`; server only                                  |
| `OPENROUTER_MODEL`   | `openai/gpt-4.1-mini` | OpenRouter model slug; used only for OpenRouter                                      |
| `WEB_SEARCH`         | `true`                | Set exactly `false` to disable live research; explanations always run without search |
| `APP_ORIGIN`         | unset                 | Set exactly `https://localhost` to allow the bundled Android app                     |
| `HOST`               | `127.0.0.1`           | Backend listening interface                                                          |
| `PORT`               | `3000`                | Backend listening port                                                               |

The default backend uses the [OpenAI Responses API with hosted web search](https://developers.openai.com/api/docs/guides/tools-web-search). For an OpenRouter key, set `AI_PROVIDER=openrouter`, `OPENROUTER_API_KEY`, and optionally `OPENROUTER_MODEL` in the server's ignored `.env` file. OpenRouter uses Chat Completions with its [web search plugin](https://openrouter.ai/docs/guides/features/plugins/web-search), explicitly selecting Exa with up to five results for research. Explanations do not enable search. Only provider citation annotations become source cards; answers without citations remain unverified.

No separate search key is needed. Model and web search calls incur provider charges, including OpenRouter's Exa search costs. With research search enabled, OpenAI requires tool use and OpenRouter enables its search plugin. The server does not fetch URLs suggested by users or models. Source availability and quality depend on the provider. Keep real keys in the backend's environment or secret store; the ignored local `.env` is not pushed or included in the APK. Restart the backend after changing it. Android still requires a reachable HTTPS backend via `STUDY_API_URL`.

## Build and review Android

Requires JDK 21, Android SDK platform 36 / build tools 36, and an Android 7.0+ (API 24+) device or emulator. Set `ANDROID_HOME` to the SDK directory, or configure `android/local.properties` through Android Studio. The Gradle wrapper is checked in.

```sh
npm ci
# For AI: set this public origin to your separately running HTTPS backend.
# The backend must set APP_ORIGIN=https://localhost.
STUDY_API_URL=https://your-study-backend.example npm run android:build

# Or build a notes-only review APK with clear AI setup guidance:
npm run android:build

adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

`STUDY_API_URL` is a **build-time public origin**, not a secret. It must be HTTPS, with no path, credentials, query, or fragment. It is embedded only into generated assets, along with a restrictive network content policy. Do not put a provider key in it. HTTP/mixed content is disabled. The app has no backend configured by default; it never calls a sample server. Use an HTTPS endpoint reachable from the device for connected review. An emulator's `localhost` is the device itself, not the development computer.

For Android Studio, run `STUDY_API_URL=https://your-study-backend.example npm run android:sync`, then open `android/`. Sync again after web changes or backend URL changes. `www/` and copied Android assets are generated and ignored. CI builds a debug APK without an AI backend and attaches it as `ungai-study-debug`; release signing and store publication are outside this change.

Review on device: open My library, save a note, edit it, restart the app in airplane mode, reopen the note, then delete it. With a configured backend, ask for a Biology explanation and a research answer, open a source in the external browser, save the answer, and reopen it from My library. Without a backend/key, submitting must show setup guidance and never an answer.

## Storage and privacy

Questions are sent to the configured provider. OpenAI requests use `store: false`; OpenRouter routes requests to the selected model provider and, for research with search enabled, Exa. Each provider's data policies still apply. The backend does not log questions or persist them. Follow-ups send the original question but not prior answers. Avoid personal information in prompts.

Up to 100 personal notes and 40 saved answers (including source links) use localStorage on this device/browser. Notes need no network connection in the bundled Android app. There are no accounts, cross-device sync, or export. Clearing app/browser data or uninstalling removes saved work. Android backup is disabled. Storage errors leave unsaved note text in place and show an actionable message.

## Checks

```sh
npm run check
npm test
npm run android:build
```

Tests cover provider fixtures, citations/unsafe links, configuration and failures, mode/subject validation, Android origin restrictions, generated asset configuration, and note persistence/edit/delete/limits/storage errors. The shared UI can also be reviewed in a mobile browser; that does not replace Android device testing.

## Before public hosting

The backend has a global limit of 12 requests/minute and 3 concurrent requests per process, bounded inputs/outputs, a 90-second provider timeout, and browser origin checks. **Add authentication, per-user quotas, HTTPS, and provider spend limits before exposing it publicly.** CORS is not authentication; a native client can forge headers. Multiple server instances do not share limits. Set `HOST=0.0.0.0` only when required by your hosting setup. Keep `.env` and keys out of source control and Android builds. Only explicit public assets are served; provider error details are not forwarded.
