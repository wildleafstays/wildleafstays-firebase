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

test("property page loads inventory automatically and offers direct booking", () => {
  assert.doesNotMatch(propertyHtml, /id="availabilityButton"/);
  assert.doesNotMatch(propertyHtml, />\s*Check availability\s*</);
  assert.doesNotMatch(propertyHtml, /Available rooms and rates/);
  assert.match(propertyHtml, /class="availability-form"/);
  assert.match(propertySource, /await searchAvailability\(\{ resetBooking: false \}\)/);
  assert.match(propertySource, /function scheduleAvailabilitySearch\(\)/);
  assert.match(propertySource, /"Book now"/);
  assert.match(propertySource, /GST and any additional fees shown before payment/);
  assert.doesNotMatch(propertySource, /GST and mandatory fees shown before payment/);
  assert.match(propertySource, /async function startBooking\(option, button\)/);
  assert.match(propertySource, /await createHold\(null, \{ scrollToGuest: true \}\)/);
  assert.doesNotMatch(propertySource, /"Get exact price"/);
});

test("property search defaults to today, one night, one room and two adults", () => {
  assert.match(propertySource, /const defaultArrival = today/);
  assert.match(propertySource, /: addDays\(arrival, 1\)/);
  assert.match(propertySource, /query\.get\("rooms"\) \|\| 1/);
  assert.match(propertySource, /query\.get\("adults"\) \|\| 2/);
});

test("hotel room categories are not repeated in the property summary", () => {
  assert.match(propertySource, /Repeating them in the property summary makes the page noisy/);
  assert.doesNotMatch(propertySource, /const card = element\("article", "room-category-summary"\)/);
});

test("available rates use OTA-style room facts and calendar-backed totals", () => {
  assert.match(propertySource, /ota-rate-card/);
  assert.match(propertySource, /category\?\.maxOccupancy/);
  assert.match(propertySource, /mealPlanLabel/);
  assert.match(propertySource, /option\.estimatedTotalMinor/);
  assert.match(propertySource, /GST and any additional fees shown before payment/);
});
