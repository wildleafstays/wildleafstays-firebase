import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

const js = fs.readFileSync(new URL("../admin.js", import.meta.url), "utf8");

const css = fs.readFileSync(new URL("../styles.css", import.meta.url), "utf8");

test("room category setup uses owner language and hides internal category code", () => {
  const match = html.match(/<form id="roomCategoryForm"[\s\S]*?<\/form>/);

  assert.ok(match, "room category form must exist");

  const form = match[0];

  assert.match(form, /Room category name/);
  assert.match(form, /Base adults included in room price/);
  assert.match(form, /Base children included in room price/);
  assert.match(form, /Default extra adult/);
  assert.match(form, /Default extra child/);
  assert.doesNotMatch(form, /name="baseOccupancy"/);
  assert.match(form, /How many guests can stay in total\?/);
  assert.match(form, /What does this room include\?/);
  assert.match(form, /id="roomCategoryAmenityOptions"/);
  assert.doesNotMatch(form, /name="code"/);
});

test("room category creation persists selected checkbox amenities", () => {
  assert.match(js, /from "\.\/amenity-catalog\.js"/);
  assert.match(js, /PROPERTY_AMENITY_GROUPS/);
  assert.match(js, /ROOM_AMENITY_GROUPS/);
  assert.match(js, /input\[name="roomAmenity"\]:checked/);
  assert.match(js, /room-categories\/\$\{roomCategoryId\}\/amenities/);
  assert.match(js, /amenityCodes: selectedAmenityCodes/);
});

test("room category photos remain separate from property photos", () => {
  const form = html.match(
    /<form\b[^>]*id="roomCategoryImageUploadForm"[^>]*>[\s\S]*?<\/form>/,
  );

  assert.ok(form, "room category photo form must exist");

  assert.match(form[0], /id="roomCategoryImageCategory"/);

  assert.match(form[0], /id="roomCategoryMediaList"/);

  assert.match(form[0], /name="file"/);

  assert.match(
    form[0],
    /These\s+stay\s+separate\s+from\s+your\s+overall\s+property\s+photographs/,
  );
});

test("room category photo UI uses dedicated category media APIs", () => {
  assert.match(js, /room-categories\/\$\{roomCategoryId\}\/uploads\/images/);

  assert.match(
    js,
    /room-categories\/\$\{roomCategoryId\}\/media\/\$\{mediaId\}/,
  );

  assert.match(js, /state\.layout\?\.roomCategoryMedia/);

  assert.match(js, /archiveRoomCategoryMedia/);
});

test("owner category selectors do not expose internal category codes", () => {
  assert.doesNotMatch(js, /\$\{category\.code\}[^\x60]*\$\{category\.name\}/);
});

test("room category summary reports amenities and photos", () => {
  assert.match(js, /roomCategoryAmenities/);

  assert.match(js, /roomCategoryMedia/);

  assert.match(js, /category-summary-metrics/);
  assert.match(js, /amenityCount/);
  assert.match(js, /photoCount/);
});

test("property editor uses one-at-a-time sections without replacing existing forms", () => {
  assert.match(js, /function setupPropertyEditorWorkspace\(\)/);
  assert.match(js, /data-editor-accordion/);
  assert.match(js, /if \(candidate !== details\) candidate\.open = false/);
  assert.match(js, /editorAccordionItem\("profile", "Property profile"\)/);
  assert.match(js, /editorAccordionItem\("categories", "Room categories"\)/);
  assert.match(js, /editorAccordionItem\("rooms", "Add rooms"\)/);
  assert.match(js, /editorAccordionItem\("amenities", "Property amenities"\)/);
  assert.match(
    js,
    /editorAccordionItem\([\s\S]*?"commercial",[\s\S]*?"Booking rules and charges"/,
  );

  for (const formId of [
    "profileForm",
    "roomCategoryForm",
    "roomCategoryImageUploadForm",
    "physicalUnitForm",
    "policiesForm",
    "commercialRulesForm",
    "amenitiesForm",
    "imageUploadForm",
    "documentUploadForm",
  ]) {
    assert.match(html, new RegExp(`id="${formId}"`));
  }

  assert.match(css, /\.editor-accordion-item/);
  assert.match(css, /#accommodationList,[\s\S]*\.physical-room-card-list/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.editor-progress-card/);
});

test("Wildleaf controls GST while hotel owners consent and manage other booking rules", () => {
  const form = html.match(
    /<form\b[^>]*id="commercialRulesForm"[^>]*>[\s\S]*?<\/form>/,
  );

  assert.ok(form, "commercial rules form must exist");
  assert.match(form[0], /name="gstRulesAccepted"/);
  assert.doesNotMatch(form[0], /name="gstRatePercent"/);
  assert.match(form[0], /Property owners cannot change GST percentages/);
  assert.match(form[0], /name="infantMaxAge"/);
  assert.match(form[0], /name="childMaxAge"/);
  assert.match(form[0], /name="freeCancellationDays"/);
  assert.match(form[0], /name="lateCancellationPercent"/);
  assert.match(form[0], /name="noShowPercent"/);
  assert.match(form[0], /name="feeEnabled"/);
  assert.match(form[0], /name="feeBasis"/);

  assert.match(js, /priceMode: "EXCLUSIVE"/);
  assert.match(js, /taxMode: "POLICIES"/);
  assert.match(js, /commercial\/hotel-gst-consent/);
  assert.match(js, /platform\/commercial\/hotel-gst-rules/);
  assert.match(js, /guest-age-policy/);
  assert.match(js, /cancellation-policies/);
  assert.match(js, /cancellation-assignments/);
  assert.match(js, /fee-policies/);
  assert.match(form[0], /Room rates continue to come from your inventory/);
});

test("GST consent is read before any commercial configuration refresh", () => {
  const start = js.indexOf(
    'byId("commercialRulesForm").addEventListener("submit"',
  );
  const end = js.indexOf(
    'byId("roomCategoryImageUploadForm").addEventListener',
    start,
  );

  assert.ok(start >= 0 && end > start, "commercial submit handler must exist");
  const handler = js.slice(start, end);
  const acceptanceRead = handler.indexOf(
    "form.elements.gstRulesAccepted.checked",
  );
  const firstRefresh = handler.indexOf(
    "await refreshCommercialConfiguration()",
  );

  assert.ok(
    acceptanceRead >= 0,
    "GST acceptance must be read from the submitted form",
  );
  assert.ok(
    firstRefresh === -1 || firstRefresh > acceptanceRead,
    "the form must not be refreshed before reading GST acceptance",
  );
});

test("guest age rules explain free infants and paid occupancy-counted children", () => {
  const form = html.match(
    /<form\b[^>]*id="commercialRulesForm"[^>]*>[\s\S]*?<\/form>/,
  );

  assert.ok(form, "commercial rules form must exist");
  assert.match(form[0], /Infant stays free up to age/);
  assert.match(form[0], /id="guestAgeExplanation"/);
  assert.doesNotMatch(form[0], /name="infantsCountTowardsOccupancy"/);
  assert.doesNotMatch(form[0], /name="infantsChargeAsChildren"/);
  assert.match(js, /Infant: age 0 to \$\{infantMaxAge\}/);
  assert.match(js, /Stays free and does not count towards room occupancy/);
  assert.match(
    js,
    /Charged at the child rate and counts towards room occupancy/,
  );
  assert.match(js, /infantsCountTowardsOccupancy: false/);
  assert.match(js, /infantsCountTowardsChildLimit: false/);
  assert.match(js, /infantsChargeAsChildren: false/);
});

test("booking rule readiness identifies missing records and sends a valid no-show tier", () => {
  assert.match(html, /id="commercialMissingItems"/);
  assert.match(js, /function commercialConfigurationMissing/);
  assert.match(js, /cancellation and no-show rules/);
  assert.match(js, /cancellation rules for/);

  const noShow = js.match(
    /triggerType: "NO_SHOW",[\s\S]*?penaltyValue: noShowPercent \* 100,/,
  );
  assert.ok(noShow, "no-show request must exist");
  assert.doesNotMatch(noShow[0], /minimumMinutesBeforeArrival/);
});

test("additional fees are optional and fee payloads omit inapplicable null fields", () => {
  const form = html.match(
    /<form\b[^>]*id="commercialRulesForm"[^>]*>[\s\S]*?<\/form>/,
  );

  assert.ok(form, "commercial rules form must exist");
  assert.match(form[0], /Optional additional fee/);
  assert.match(form[0], /Leave this unticked when the property has no/);
  assert.match(js, /additional-fee setting \(none is allowed\)/);
  assert.match(js, /const feeVersionBody =/);
  assert.match(js, /feeVersionBody\.rateBasisPoints =/);
  assert.match(js, /feeVersionBody\.amountMinor =/);
  assert.doesNotMatch(js, /amountMinor: percentage \? null/);
  assert.doesNotMatch(js, /rateBasisPoints: percentage \?/);
  assert.match(js, /feeMode: desiredFeeMode/);
  assert.match(js, /desiredFeeMode = feeEnabled \? "POLICIES" : "NO_FEES"/);
});

test("GST synchronization completes before commercial readiness is loaded", () => {
  const refresh = js.match(
    /async function refreshCommercialConfiguration\(\) \{[\s\S]*?\n\}/,
  );

  assert.ok(refresh, "commercial refresh function must exist");
  const gstRead = refresh[0].indexOf("commercial/hotel-gst-consent");
  const commercialRead = refresh[0].indexOf("api(`${base}/commercial`)");
  assert.ok(gstRead >= 0, "GST consent must be refreshed");
  assert.ok(commercialRead >= 0, "commercial configuration must be refreshed");
  assert.ok(
    gstRead < commercialRead,
    "GST synchronization must finish before commercial readiness is read",
  );
});

test("saving booking rules makes a property without promotions bookable", () => {
  assert.match(js, /const promotionConfiguration = await api\(/);
  assert.match(js, /`\$\{base\}\/promotions`/);
  assert.match(js, /`\$\{base\}\/promotions\/settings`/);
  assert.match(js, /promotionMode: "NO_PROMOTIONS"/);
  assert.match(js, /commercial-promotion-settings/);
});

test("approved and live owners can accept responsibility and regain editing", () => {
  assert.match(html, /id="ownerResponsibilityCard"/);
  assert.match(html, /id="ownerResponsibilityForm"/);
  assert.match(html, /name="accepted"/);
  assert.match(js, /\/owner-responsibility/);
  assert.match(
    js,
    /termsVersionId: state\.ownerResponsibility\.currentTerms\.id/,
  );
  assert.match(js, /\["APPROVED", "LIVE"\]/);
  assert.match(js, /state\.ownerResponsibility\?\.editable/);
  assert.match(js, /Property editing is enabled/);
});

test("physical room setup uses owner language and supports floors", () => {
  const match = html.match(
    /<form\b[^>]*id="physicalUnitForm"[^>]*>[\s\S]*?<\/form>/,
  );

  assert.ok(match, "physical room form must exist");

  const form = match[0];

  assert.match(form, /Room Name \/ Number/);
  assert.match(form, /Room Category/);
  assert.match(form, /id="unitFloor"/);
  assert.match(form, /Which floor is this room on\?/);
  assert.match(
    form,
    /Enter\s+the\s+name\s+or\s+number\s+actually\s+displayed\s+on\s+the\s+room/,
  );

  const roomNameIndex = form.indexOf("Room Name / Number");
  const categoryIndex = form.indexOf("Room Category");
  const floorIndex = form.indexOf('id="unitFloor"');

  assert.ok(roomNameIndex >= 0);
  assert.ok(categoryIndex > roomNameIndex);
  assert.ok(floorIndex > categoryIndex);
});

test("Step 3 exposes optional building and floor setup without inventing a structure", () => {
  assert.match(html, /id="structureForm"/);
  assert.match(html, /id="floorForm"/);
  assert.match(html, /id="floorStructure"/);

  assert.ok(js.includes("/structures/${structureId}/floors"));

  assert.ok(js.includes("structureType: values.structureType"));

  assert.doesNotMatch(js, /Main Building.*structureType/);
});

test("physical room creation preserves the same idempotency key until UI refresh succeeds", () => {
  assert.ok(js.includes("pendingPhysicalUnitCreateKeys"));

  const start = js.indexOf('byId("physicalUnitForm").addEventListener');

  const end = js.indexOf('byId("imageUploadForm").addEventListener', start);

  assert.ok(start >= 0 && end > start);

  const handler = js.slice(start, end);

  assert.ok(handler.includes("idempotencyKey: key"));
  assert.ok(handler.includes("floorId: floor.id"));
  assert.ok(handler.includes("structureId: floor.structureId"));

  const refreshIndex = handler.indexOf("await refreshEditorData()");
  const resetIndex = handler.indexOf("form.reset()");
  const releaseIndex = handler.indexOf("pendingPhysicalUnitCreateKeys.delete");

  assert.ok(refreshIndex >= 0);
  assert.ok(resetIndex > refreshIndex);
  assert.ok(releaseIndex > resetIndex);
});

test("actual room list shows room-specific floor view and accessibility information", () => {
  assert.ok(js.includes("physical-room-card-list"));
  assert.ok(js.includes("physical-room-card"));
  assert.ok(js.includes("unit.floorId"));
  assert.ok(js.includes('details.push("Lift")'));
  assert.ok(js.includes('details.push("Wheelchair friendly")'));
  assert.ok(js.includes('details.push("Step-free access")'));
});

test("room category stores separate base guest counts and category extra guest defaults", () => {
  const match = js.match(
    /byId\("roomCategoryForm"\)\.addEventListener\("submit",[\s\S]*?\n\}\);/,
  );

  assert.ok(match, "room category submit handler must exist");

  assert.match(match[0], /baseOccupancy:\s*baseAdults \+ baseChildren/);
  assert.match(match[0], /baseAdults,/);
  assert.match(match[0], /baseChildren,/);
  assert.match(match[0], /defaultExtraAdultMinor,/);
  assert.match(match[0], /defaultExtraChildMinor,/);
});

test("Step 4B owner calendar uses room-category rows instead of technical rate-product setup", () => {
  const screen = html.match(
    /<section id="calendarScreen"[\s\S]*?<section id="controlScreen"/,
  );

  assert.ok(screen, "calendar screen must exist");

  assert.match(screen[0], /Room rates and availability/);
  assert.match(screen[0], /Availability control/);
  assert.match(screen[0], /Rates & inventory/);

  assert.doesNotMatch(screen[0], />Floor rate/);
  assert.doesNotMatch(screen[0], />Ceiling rate/);
  assert.doesNotMatch(screen[0], />Configure sellable product/);
});

test("Step 4B owner grid exposes inventory, EP, extra adult and extra child by category", () => {
  assert.match(js, /"Inventory"/);
  assert.match(js, /\["EP", "base"\]/);
  assert.match(js, /\["Extra adult", "adult"\]/);
  assert.match(js, /\["Extra child", "child"\]/);

  assert.match(js, /pendingRateCalendarSaveKeys/);
  assert.match(js, /pendingInventoryControlKeys/);

  assert.match(js, /extraAdultMinor\s*=\s*rupeesToMinor\(adultInput\.value\)/);

  assert.match(js, /extraChildMinor\s*=\s*rupeesToMinor\(childInput\.value\)/);
});

test("Step 4B5A owner calendar provides 7, 14 and 30 day views", () => {
  const screen = html.match(
    /<section id="calendarScreen"[\s\S]*?<section id="controlScreen"/,
  );

  assert.ok(screen, "calendar screen must exist");

  assert.match(screen[0], /data-calendar-view-days="7"/);
  assert.match(screen[0], /data-calendar-view-days="14"/);
  assert.match(screen[0], /data-calendar-view-days="30"/);

  assert.match(js, /calendarViewDays:\s*14/);
  assert.match(js, /function setOwnerCalendarView\(days\)/);
  assert.match(js, /shiftDate\(startDate, days\)/);
  assert.match(js, /syncOwnerCalendarViewButtons/);
  assert.match(screen[0], /id="previousCalendarWindow"/);
  assert.match(screen[0], /id="nextCalendarWindow"/);
  assert.match(screen[0], /id="todayCalendarWindow"/);
  assert.match(js, /function moveOwnerCalendarWindow\(direction\)/);
  assert.match(js, /moveOwnerCalendarWindow\(-1\)/);
  assert.match(js, /moveOwnerCalendarWindow\(1\)/);
});

test("Step 4B5D owner calendar removes legacy technical controls and clearly labels inventory states", () => {
  const screen = html.match(
    /<section id="calendarScreen"[\s\S]*?<section id="controlScreen"/,
  );

  assert.ok(screen, "calendar screen must exist");

  assert.match(screen[0], /id="ownerInventoryControlForm"/);
  assert.match(screen[0], /id="ownerRateBulkForm"/);

  assert.doesNotMatch(screen[0], /id="calendarRateProduct"/);
  assert.doesNotMatch(screen[0], /id="saveRateCalendar"/);
  assert.doesNotMatch(screen[0], /id="ratePlanForm"/);
  assert.doesNotMatch(screen[0], /id="rateProductForm"/);
  assert.doesNotMatch(screen[0], /id="inventoryControlForm"/);

  assert.doesNotMatch(js, /byId\("calendarRateProduct"\)/);
  assert.doesNotMatch(js, /byId\("ratePlanForm"\)/);
  assert.doesNotMatch(js, /byId\("rateProductForm"\)/);
  assert.doesNotMatch(js, /byId\("saveRateCalendar"\)/);
  assert.doesNotMatch(js, /byId\("inventoryControlForm"\)/);
  assert.doesNotMatch(js, /function syncProductType\(\)/);
  assert.doesNotMatch(js, /function syncInventoryBucketType\(\)/);

  assert.doesNotMatch(
    js,
    /Shared category inventory controls for this sale mode will be enabled in the next backend step/,
  );

  assert.match(js, /owner-inventory-state-available/);
  assert.match(js, /owner-inventory-state-sold-out/);
  assert.match(js, /owner-inventory-state-closed/);
  assert.match(js, /textContent = `0\/\$\{inventoryCapacity\} Sold out`/);
  assert.match(js, /textContent = "Closed"/);
  assert.match(js, /Available`/);
});

test("Step 4B5C owner can bulk update EP or extra guest rates by category and date range", () => {
  const screen = html.match(
    /<section id="calendarScreen"[\s\S]*?<section id="controlScreen"/,
  );

  assert.ok(screen, "calendar screen must exist");

  assert.match(screen[0], /id="ownerRateBulkForm"/);
  assert.match(screen[0], /value="ALL">All room categories/);
  assert.match(screen[0], /value="base">EP rate/);
  assert.match(screen[0], /value="adult">Extra adult/);
  assert.match(screen[0], /value="child">Extra child/);
  assert.match(screen[0], /Apply &amp; save/);

  assert.match(js, /function syncOwnerRateBulkForm\(categories, dates\)/);
  assert.match(js, /async function applyOwnerRateBulkUpdate\(\)/);
  assert.match(js, /selectedDates\.includes\(input\.dataset\.stayDate\)/);
  assert.match(js, /persistOwnerCategoryCalendar\(plan\.category\.id/);
  assert.match(js, /refreshAfterSave: false/);
  assert.match(js, /await refreshCalendarData\(\)/);
});

test("Step 4B5B owner rate cells are compact and open for editing on click", () => {
  const render = js.match(
    /function renderOperationsCalendar\(\)[\s\S]*?byId\("calendarFilters"\)\.addEventListener/,
  );

  assert.ok(render, "owner calendar render function must exist");

  assert.match(render[0], /owner-rate-display/);
  assert.match(render[0], /owner-rate-editor-input hidden/);
  assert.match(render[0], /display\.addEventListener\("click", beginEditing\)/);
  assert.match(render[0], /input\.addEventListener\("blur", \(\) =>/);
  assert.match(render[0], /await saveOwnerCategoryCalendar\(category\.id\)/);
  assert.match(render[0], /event\.key === "Enter"/);
  assert.match(render[0], /event\.key === "Escape"/);

  assert.match(render[0], /input\.dataset\.categoryId = category\.id/);
  assert.match(render[0], /input\.dataset\.stayDate = date/);
});

test("owner inventory cells open on click and save a safe daily capacity override", () => {
  const render = js.match(
    /function renderOperationsCalendar\(\)[\s\S]*?byId\("calendarFilters"\)\.addEventListener/,
  );

  assert.ok(render, "owner calendar render function must exist");
  assert.match(render[0], /owner-inventory-display/);
  assert.match(render[0], /owner-inventory-editor-input hidden/);
  assert.match(render[0], /display\.addEventListener\("click", beginEditing\)/);
  assert.match(
    render[0],
    /saveOwnerInventoryCell\(category\.id, date, nextCapacity\)/,
  );

  assert.match(js, /async function saveOwnerInventoryCell/);
  assert.match(js, /capacityOverride,/);
  assert.match(js, /stopSell: false/);
  assert.match(js, /shiftDate\(stayDate, 1\)/);
});

test("Step 4B4B owner calendar saves cells by actual stay date instead of array position", () => {
  assert.match(js, /data-stay-date="\$\{day\.stayDate\}"/);

  assert.match(js, /input\.dataset\.stayDate = date/);

  const ownerSave = js.match(
    /async function saveOwnerCategoryCalendar\(categoryId\)[\s\S]*?function renderOperationsCalendar\(\)/,
  );

  assert.ok(ownerSave, "owner category calendar save function must exist");

  assert.doesNotMatch(ownerSave[0], /data-day-index/);
});

test("Step 4B4A owner calendar preserves inherited extra-guest defaults", () => {
  assert.match(
    js,
    /extraAdultMinor === category\.defaultExtraAdultMinor[\s\S]*?\? null[\s\S]*?: extraAdultMinor/,
  );

  assert.match(
    js,
    /extraChildMinor === category\.defaultExtraChildMinor[\s\S]*?\? null[\s\S]*?: extraChildMinor/,
  );

  assert.match(js, /extraAdultMinor: storedExtraAdultMinor/);
  assert.match(js, /extraChildMinor: storedExtraChildMinor/);
});

test("Step 4B does not silently use mismatched category pricing defaults", () => {
  assert.match(js, /product\.includedAdults !== category\.baseAdults/);

  assert.match(
    js,
    /product\.extraAdultMinor !== category\.defaultExtraAdultMinor/,
  );

  assert.match(js, /existing rate setup must be synchronized/);
});

test("Step 4B2 owner can create or synchronize one simple category base rate", () => {
  assert.match(js, /configureOwnerCategoryBaseRate/);

  assert.match(js, /pendingOwnerBaseRateKeys/);

  assert.match(js, /rates\/room-categories\/\$\{categoryId\}\/base-rate/);

  assert.match(js, /calendar \? "Sync setup" : "Set base rate"/);

  assert.match(js, /expectedVersion/);
});
