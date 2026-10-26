import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const js = await readFile(new URL("../admin.js", import.meta.url), "utf8");
const css = await readFile(
  new URL("../experience.css", import.meta.url),
  "utf8",
);

test("single Command Center title and scoped admin navigation", () => {
  assert.match(js, /command-center-mode", isSuperAdmin/);
  assert.match(js, /intro\.classList\.add\("command-intro-compact"\)/);
  assert.match(
    css,
    /\.portal\.command-center-mode \.workspace-head \{ display: none; \}/,
  );
  assert.match(
    css,
    /\.portal\.command-center-mode \.sidebar nav \{ display: none; \}/,
  );
  assert.match(js, /commandBackButton/);
  assert.match(js, /showScreen\("control"\)/);
  assert.match(
    js,
    /if \(name === "control"\) await loadControlCenter\(false\)/,
  );
});
