import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const script = await readFile(new URL("../admin.js", import.meta.url), "utf8");
const stylesheet = await readFile(new URL("../experience.css", import.meta.url), "utf8");
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

test("homepage sections use native click-to-open disclosures without altering forms", () => {
  assert.match(script, /function setupHomepageDisclosurePanels\(\)/);
  assert.match(script, /document\.createElement\("details"\)/);
  assert.match(script, /document\.createElement\("summary"\)/);
  assert.match(script, /if \(other !== details\) other\.open = false/);
  assert.match(script, /details\.append\(card\)/);
  assert.match(script, /setupHomepageDisclosurePanels\(\)/);
  for (const id of [
    "homepageHeroCreateForm",
    "homepageHeroList",
    "homepageEntireHeroCreateForm",
    "homepageDestinationCreateForm",
  ]) {
    assert.ok(html.includes(id), `Original portal control ${id} remains available`);
  }
  assert.match(stylesheet, /\.partner-disclosure > summary:focus-visible/);
  assert.match(stylesheet, /@media \(max-width: 680px\)/);
});
