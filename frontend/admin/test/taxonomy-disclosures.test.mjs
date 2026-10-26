import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const script = await readFile(new URL("../admin.js", import.meta.url), "utf8");
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
test("categories and types display one click-to-open editor at a time", () => {
  assert.match(script, /function taxonomyEditorDisclosure/);
  assert.match(script, /if \(other !== details\) other\.open = false/);
  assert.match(script, /taxonomyEditorDisclosure\(\s*`Category/);
  assert.match(script, /taxonomyEditorDisclosure\(\s*`Type/);
  assert.match(script, /setupTaxonomyCreateDisclosures\(\)/);
  for (const id of [
    "propertyCategoryAdminList",
    "propertyTypeAdminList",
    "propertyCategoryCreateForm",
    "propertyTypeCreateForm",
  ]) {
    assert.ok(html.includes(`id="${id}"`));
  }
  assert.match(script, /property-category-update/);
  assert.match(script, /property-type-update/);
  assert.match(script, /property-category-create/);
  assert.match(script, /property-type-create/);
});
