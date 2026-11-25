import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

// Only the public backend origin is bundled. Provider credentials stay on Node.
const value = process.env.STUDY_API_URL || "";
let origin = "";
if (value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "STUDY_API_URL must be an HTTPS origin without credentials, path, query or fragment.",
    );
  }
  origin = url.origin;
}
await rm("www", { recursive: true, force: true });
await mkdir("www", { recursive: true });
await cp("public", "www", { recursive: true });
await writeFile(
  "www/runtime-config.js",
  `window.STUDY_API_URL = ${JSON.stringify(origin)};\n`,
);
const html = await readFile("www/index.html", "utf8");
await writeFile(
  "www/index.html",
  html.replace(
    "connect-src 'self'",
    `connect-src 'self'${origin ? ` ${origin}` : ""}`,
  ),
);
console.log(
  origin
    ? `Android web assets built for ${origin}`
    : "Android web assets built without AI backend; local notes remain available.",
);
