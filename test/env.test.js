import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const { scripts } = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

test("start loads the server .env, preserves host overrides, and allows no file", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "folio-env-"));
  // Exercise the actual start command's Node options with a private probe.
  const [command, ...args] = scripts.start.split(" ");
  assert.equal(command, "node");
  assert.equal(args.pop(), "server.js");
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  delete env.NODE_OPTIONS;
  const check = (expected, overrides = {}) => {
    const result = spawnSync(
      process.execPath,
      [
        ...args,
        "--input-type=module",
        "--eval",
        `if (process.env.OPENAI_API_KEY !== ${JSON.stringify(expected)}) process.exit(1);`,
      ],
      { cwd, env: { ...env, ...overrides }, encoding: "utf8" },
    );
    assert.equal(result.status, 0, "server environment loading failed");
    assert.equal(result.stdout, "");
    assert.match(
      result.stderr,
      /^(?:\.env not found\. Continuing without it\.\n)?$/,
    );
  };
  try {
    check(undefined);
    await writeFile(join(cwd, ".env"), "OPENAI_API_KEY=fixture-file-value\n", {
      mode: 0o600,
    });
    check("fixture-file-value");
    check("fixture-host-value", { OPENAI_API_KEY: "fixture-host-value" });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
