import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const script = new URL("../scripts/build-android-web.js", import.meta.url);
test("Android bundles only a valid HTTPS backend origin and limits network CSP to it", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "ungai-assets-"));
  try {
    await mkdir(join(cwd, "public"));
    await writeFile(
      join(cwd, "public/index.html"),
      "<meta content=\"connect-src 'self'\">",
    );
    await writeFile(
      join(cwd, "public/runtime-config.js"),
      "window.STUDY_API_URL = '';",
    );
    const build = (url) =>
      spawnSync(process.execPath, [script.pathname], {
        cwd,
        env: { ...process.env, STUDY_API_URL: url },
        encoding: "utf8",
      });
    assert.equal(build("https://study.school.example").status, 0);
    assert.match(
      await readFile(join(cwd, "www/runtime-config.js"), "utf8"),
      /https:\/\/study.school.example/,
    );
    assert.match(
      await readFile(join(cwd, "www/index.html"), "utf8"),
      /connect-src 'self' https:\/\/study.school.example/,
    );
    for (const url of [
      "http://study.example",
      "https://user:secret@study.example",
      "https://study.example/path",
      "https://study.example?key=secret",
      "https://study.example#fragment",
      "invalid",
    ])
      assert.notEqual(build(url).status, 0, url);
    assert.equal(build("").status, 0);
    assert.equal(
      await readFile(join(cwd, "www/runtime-config.js"), "utf8"),
      'window.STUDY_API_URL = "";\n',
    );
    assert.doesNotMatch(
      await readFile(join(cwd, "www/index.html"), "utf8"),
      /study.school.example/,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
