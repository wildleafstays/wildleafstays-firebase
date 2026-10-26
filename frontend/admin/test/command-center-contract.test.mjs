import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const js = await readFile(new URL("../admin.js", import.meta.url), "utf8");
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
test("Command Center preserves all operational controls and role boundaries", () => {
  assert.match(js, /function setupCommandCenterWorkspaces\(\)/);
  assert.match(js, /workspace\(\s*"All reservations"/);
  assert.match(js, /workspace\(\s*"Platform GST & statutory settings"/);
  assert.match(js, /if \(other !== details\) other\.open = false/);
  assert.match(
    js,
    /availableScreens\(state\.session\)\.includes\(\s*button\.dataset\.commandTarget/,
  );
  assert.match(js, /platformReservationListPath\(/);
  assert.match(js, /\/v1\/platform\/reservations\/operations-summary/);
  for (const id of [
    "controlCenterMetrics",
    "controlCenterFilters",
    "controlCenterReservationList",
    "loadMoreControlCenterReservations",
    "platformGstRulesCard",
    "platformGstRuleForm",
  ]) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
});
