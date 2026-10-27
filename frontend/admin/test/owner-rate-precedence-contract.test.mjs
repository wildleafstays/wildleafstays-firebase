import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const js = fs.readFileSync(new URL("../admin.js", import.meta.url), "utf8");

test("category defaults remain editable while calendar cells are date overrides", () => {
  assert.match(js, /form\.elements\.defaultBaseRate\.value/);
  assert.match(js, /saveEditorRoomCategoryDefaultRates/);
  assert.match(js, /calendar\.rateProduct\.baseRateMinor/);
  assert.doesNotMatch(js, /data-owner-base-rate/);
});

test("single-night edits persist only the edited date", () => {
  assert.match(js, /saveOwnerCategoryCalendar\(category\.id, \[date\]\)/);
  assert.match(js, /stayDates: selectedDates/);
  assert.match(js, /targetDates\.has\(day\.stayDate\)/);
});

test("the calendar identifies inherited base rates", () => {
  assert.match(js, /day\.source === "BASE"/);
  assert.match(js, /override this date only/);
});
