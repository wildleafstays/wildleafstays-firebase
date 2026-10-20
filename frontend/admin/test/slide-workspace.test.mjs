import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const js = await readFile(new URL("../admin.js", import.meta.url), "utf8");
const css = await readFile(new URL("../experience.css", import.meta.url), "utf8");
test("each existing campaign slide has its own closed-by-default editor", () => {
  assert.match(js, /for \(const \[index, slide\] of slides\.entries\(\)\)/);
  assert.match(js, /document\.createElement\("details"\)/);
  assert.match(js, /Campaign slide \$\{index \+ 1\}/);
  assert.match(js, /if \(other !== disclosure\) other\.open = false/);
  assert.match(js, /body\.append\(preview, status, form, actions\)/);
  assert.match(js, /list\.append\(disclosure\)/);
});
test("new campaign form follows slides and existing save paths stay in place", () => {
  assert.match(js, /function setupHomepageCreateSlidePanels/);
  assert.match(js, /if \(list\) list\.after\(wrap\)/);
  assert.match(js, /homepage-hero-update/);
  assert.match(js, /homepage-hero-image-replace/);
  assert.match(js, /homepage-hero-archive/);
  assert.match(css, /\.partner-slide\[open\]/);
  assert.match(css, /\.partner-create-slide/);
});
