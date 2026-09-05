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
  assert.match(propertyHtml, /class="[^"]*availability-form/);
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
  assert.match(propertySource, /category(?:\\?\\.)?\\.maxOccupancy/);
  assert.match(propertySource, /mealPlanLabel/);
  assert.match(propertySource, /option\.estimatedTotalMinor/);
  assert.match(propertySource, /GST and any additional fees shown before payment/);
});


test("property page presents published property media as an immersive photo tour", () => {
  assert.match(propertyHtml, /id="propertyGallery"/);
  assert.match(propertyHtml, /id="propertyPhotoDialog"/);
  assert.match(propertySource, /function renderPropertyGallery\(property\)/);
  assert.match(propertySource, /property\.media \|\| \[\]/);
  assert.match(propertySource, /View all \$\{media\.length\} photos/);
  assert.match(propertySource, /function propertyMediaUrl\(mediaId\)/);
});


test("hotel property page can book smart recommendations through canonical checkout", () => {
  assert.match(propertyHtml, /id="smartMatchSection"/);
  assert.match(propertyHtml, /id="smartRecommendations"/);
  assert.match(propertySource, /room-recommendations/);
  assert.match(propertySource, /function partyTotals\(\)/);
  assert.match(propertySource, /childAges: state\.units\.flatMap/);
  assert.match(propertySource, /function smartRecommendationCard\(/);
  assert.match(propertySource, /function startRecommendedBooking\(/);
  assert.match(propertySource, /Book this recommendation/);
  assert.match(propertySource, /room-mixes\/quotes/);
  assert.match(propertySource, /function renderRoomMixQuote\(/);
  assert.match(propertySource, /function createRoomMixHold\(/);
  assert.match(propertySource, /room-mixes\/\$\{state\.roomMixQuote\.id\}\/hold/);
  assert.match(propertySource, /room-mixes\/\$\{roomMixQuoteId\}\/checkout/);
  assert.match(propertySource, /state\.roomMixQuote/);
  assert.match(propertySource, /Estimated room and extra-guest total/);

  // Same-category recommendations must continue through the mature standard quote path.
  assert.match(propertySource, /recommendation\.items\.length === 1/);
  assert.match(propertySource, /\/quotes/);

  // Browser still never verifies Razorpay signatures itself.
  assert.doesNotMatch(propertySource, /razorpay_payment_id/);
  assert.doesNotMatch(propertySource, /razorpay_signature/);
});


test("property shopping starts with photography and keeps identity below the gallery", () => {
  const galleryIndex = propertyHtml.indexOf('id="propertyGallery"');
  const propertyNameIndex = propertyHtml.indexOf('id="propertyName"');
  assert.ok(galleryIndex >= 0);
  assert.ok(propertyNameIndex > galleryIndex);
  assert.doesNotMatch(propertyHtml, /class="property-hero"/);
  assert.doesNotMatch(propertyHtml, /class="booking-assurance"/);
  assert.match(propertySource, /media\.slice\(0, 5\)/);
  assert.match(propertySource, /gallery-count-/);
});

test("hotel rates are grouped into one horizontal shopping card per room category", () => {
  assert.match(propertyHtml, /room-category-rail/);
  assert.match(propertySource, /function groupRoomOptions\(options\)/);
  assert.match(propertySource, /function roomCategoryCard\(category, options, nights\)/);
  assert.match(propertySource, /rate-plan-list/);
  assert.match(propertySource, /rate-plan-choice/);
  assert.match(propertySource, /mealPlanLabel\(option\.mealPlanCode\)/);
  assert.match(propertySource, /function renderRoomAllocationControls\(category, selection\)/);
  assert.match(propertySource, /Who is staying in this room\?/);
});

test("manual room shopping uses one sticky selection ribbon and canonical checkout paths", () => {
  assert.match(propertyHtml, /id="selectionRibbon"/);
  assert.match(propertyHtml, /id="selectionContinue"/);
  assert.match(propertySource, /function renderSelectionRibbon\(\)/);
  assert.match(propertySource, /function continueRoomSelection\(button\)/);
  assert.match(propertySource, /"manual-room-quote"/);
  assert.match(propertySource, /"manual-room-mix-quote"/);
  assert.match(propertySource, /room-mixes\/quotes/);
  assert.match(propertySource, /await createRoomMixHold\(\{ scrollToGuest: true \}\)/);
  assert.match(propertySource, /await createHold\(null, \{ scrollToGuest: true \}\)/);
});

test("Wildleaf Match stays out of simple searches and is collapsible for complex groups", () => {
  assert.match(propertyHtml, /<details\s+id="smartMatchSection"/);
  assert.match(propertySource, /const complexSearch =/);
  assert.match(
    propertySource,
    /state\.units\.length > 1 \|\| totals\.adults \+ totals\.children > 2/,
  );
  assert.match(propertySource, /smartMatchSection\.open = false/);
});

test("room shopping keeps Razorpay verification server-side", () => {
  assert.doesNotMatch(propertySource, /razorpay_payment_id/);
  assert.doesNotMatch(propertySource, /razorpay_signature/);
});
