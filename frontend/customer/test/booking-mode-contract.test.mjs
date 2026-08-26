import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const homeHtml = await readFile(
  new URL("../index.html", import.meta.url),
  "utf8",
);
const homeSource = await readFile(
  new URL("../app.js", import.meta.url),
  "utf8",
);
const propertyHtml = await readFile(
  new URL("../property.html", import.meta.url),
  "utf8",
);
const propertySource = await readFile(
  new URL("../property.js", import.meta.url),
  "utf8",
);

test("guest discovery clearly separates hotel rooms from entire villas", () => {
  assert.match(homeHtml, /id="modeHotel"/);
  assert.match(homeHtml, /id="modeVilla"/);
  assert.match(homeHtml, />Hotel rooms</);
  assert.match(homeHtml, />Entire villas</);
  assert.match(homeSource, /saleModeAllows/);
  assert.match(homeSource, /ROOMS_ONLY/);
  assert.match(homeSource, /FULL_PROPERTY_ONLY/);
  assert.match(homeSource, /mode: state\.mode/);
});

test("property booking shows only the product selected by the guest", () => {
  assert.match(propertyHtml, /id="bookingModeBadge"/);
  assert.match(propertyHtml, /id="unitCountField"/);
  assert.match(propertySource, /expectedProductType/);
  assert.match(propertySource, /"FULL_PROPERTY"\s*:\s*"ROOM_CATEGORY"/);
  assert.match(propertySource, /state\.bookingMode === "villa"\) count = 1/);
});

test("villa presentation explicitly uses the shared room source", () => {
  assert.match(propertySource, /One villa, one shared inventory/);
  assert.match(propertySource, /calculated from the room categories below/);
  assert.doesNotMatch(propertySource, /villaBaseRate|separateVillaRate/);
});
