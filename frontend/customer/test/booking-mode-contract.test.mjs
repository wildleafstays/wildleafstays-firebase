import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const firebaseConfig = JSON.parse(
  await readFile(new URL("../../../firebase.json", import.meta.url), "utf8"),
);

const homeHtml = await readFile(
  new URL("../index.html", import.meta.url),
  "utf8",
);
const homeSource = await readFile(
  new URL("../app.js", import.meta.url),
  "utf8",
);
const homeStyles = await readFile(
  new URL("../experience.css", import.meta.url),
  "utf8",
);
const discoveryStyles = await readFile(
  new URL("../booking-discovery.css", import.meta.url),
  "utf8",
);
const destinationHtml = await readFile(
  new URL("../destination.html", import.meta.url),
  "utf8",
);
const destinationSource = await readFile(
  new URL("../destination.js", import.meta.url),
  "utf8",
);
const destinationStyles = await readFile(
  new URL("../destination.css", import.meta.url),
  "utf8",
);

const entirePropertyHtml = await readFile(
  new URL("../entire-properties.html", import.meta.url),
  "utf8",
);
const entirePropertySource = await readFile(
  new URL("../entire-properties.js", import.meta.url),
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
const mobileSearchSource = await readFile(
  new URL("../mobile-search.js", import.meta.url),
  "utf8",
);
const mobileSearchStyles = await readFile(
  new URL("../mobile-search.css", import.meta.url),
  "utf8",
);
test("homepage search opens a dedicated destination experience", () => {
  assert.doesNotMatch(homeHtml, /id="modeAll"|id="modeHotel"|id="modeVilla"/);
  assert.doesNotMatch(homeHtml, /id="entirePropertyEntry"/);
  assert.match(homeHtml, /id="privateStay"[^>]*type="checkbox"/);
  assert.match(homeSource, /function allowsEntireProperty\(property\)/);
  assert.match(homeHtml, /id="stayMode"/);
  assert.match(homeHtml, /Book individual rooms/);
  assert.match(homeHtml, /Book an entire property/);
  assert.match(homeSource, /stayModeSelect\?\.value === "room"/);
  assert.match(homeSource, /exclusiveOnly \? allowsEntireProperty\(property\)/);
  assert.match(homeSource, /property\.saleMode === "FULL_PROPERTY_ONLY"/);
  assert.match(homeSource, /property\.saleMode === "BOTH"/);
  assert.match(homeSource, /"Explore entire property"/);
  assert.match(homeSource, /"Explore available rooms"/);
  assert.match(
    homeSource,
    /location\.assign\(destinationUrl\(form\.destination\.value\.trim\(\)\)\)/,
  );
  assert.match(homeSource, /function destinationUrl\(destination\)/);
  assert.match(
    homeSource,
    /`\/stays\/\$\{encodeURIComponent\(slugifyDestination\(label\)\)\}/,
  );
  assert.match(destinationHtml, /id="destinationSearchForm"/);
  assert.match(destinationHtml, /id="destinationResults"/);
  assert.match(destinationSource, /\/v1\/public\/smartstay\/search/);
});

test("SmartStay distinguishes date-specific quotes from static room starting rates", () => {
  assert.doesNotMatch(homeSource, /property\\.startingRoomRateMinor/);
  assert.match(homeSource, /smartstayEstimateMinor/);
  assert.match(homeSource, /smartstay-price-disclaimer/);
  assert.match(homeSource, /Excludes GST, fees and discounts/);
});

test("BOTH properties present rooms and entire-property inventory together", () => {
  assert.match(propertyHtml, /id="entirePropertyOffer"/);
  assert.match(propertyHtml, /id="roomChoiceDivider"/);
  assert.doesNotMatch(propertyHtml, /property-booking-mode-nav\.js/);
  assert.match(propertySource, /property\.saleMode === "BOTH"/);
  assert.match(propertySource, /state\.allowsRooms \? request/);
  assert.match(propertySource, /state\.allowsEntire/);
  assert.match(propertySource, /function renderEntirePropertyOffer\(nights\)/);
});

test("property page uses one compact planner and eight database-backed information tabs", () => {
  assert.match(propertyHtml, /id="planYourStayTitle">Plan Your Stay/);
  assert.match(propertyHtml, /id="availabilityForm"/);
  assert.equal((propertyHtml.match(/id="availabilityForm"/g) || []).length, 1);
  assert.match(propertyHtml, /Update Stay Details/);
  assert.match(propertyHtml, /id="propertyTabs"/);
  assert.match(propertyHtml, /id="propertyTabPanel"/);
  assert.doesNotMatch(propertyHtml, /class="property-overview panel-section"/);
  assert.doesNotMatch(propertyHtml, /class="panel-section policies-section"/);
  for (const label of [
    "Overview",
    "About Property",
    "Facilities/Spaces",
    "Services",
    "Location & Accessibility",
    "Things to Know",
    "Rules and Policies",
    "Reviews",
  ]) {
    assert.match(propertySource, new RegExp(`"${label}"`));
  }
  assert.match(propertySource, /function guestContent\(property\)/);
  assert.match(propertySource, /property\.guestContent/);
  assert.match(propertySource, /renderGuestOverview/);
  assert.match(propertySource, /renderGuestAbout/);
  assert.match(propertySource, /renderGuestFacilities/);
  assert.match(propertySource, /renderGuestServices/);
  assert.match(propertySource, /renderGuestLocation/);
  assert.match(propertySource, /renderGuestThings/);
  assert.match(propertySource, /renderGuestRules/);
  assert.match(propertySource, /renderGuestReviews/);
  assert.match(propertySource, /property\.servicesDescription/);
  assert.match(propertySource, /property\.spacesDescription/);
  assert.match(propertySource, /property\.nearbyAttractions/);
  assert.match(propertySource, /property\.cancellation/);
  assert.match(propertySource, /property\.reviews/);
  assert.doesNotMatch(propertySource, /Live choices are ready for/);
});

test("property page lets guests choose the existing entire-property or room flow", () => {
  assert.match(propertyHtml, /id="stayModeChooser"/);
  assert.match(propertyHtml, /id="chooseEntireProperty"/);
  assert.match(propertyHtml, /id="chooseIndividualRooms"/);
  assert.match(
    propertySource,
    /function selectStayDisplayMode\(mode, reveal\)/,
  );
  assert.match(propertySource, /state\.displayMode/);
});

test("mobile property content is viewport-bound while tabs remain horizontally scrollable", () => {
  assert.match(mobileSearchStyles, /Property mobile viewport guard/);
  assert.match(
    mobileSearchStyles,
    /\.property-body:not\(\.checkout-view\) \.property-shopping-shell\s*\{[\s\S]*?min-width: 0;[\s\S]*?max-width: calc\(100% - 20px\);/,
  );
  assert.match(
    mobileSearchStyles,
    /\.property-body:not\(\.checkout-view\) \.property-information\s*\{\s*overflow: hidden;/,
  );
  assert.match(
    mobileSearchStyles,
    /\.property-body:not\(\.checkout-view\) \.property-tabs\s*\{[\s\S]*?overflow-x: auto;[\s\S]*?touch-action: pan-x;/,
  );
  assert.match(
    mobileSearchStyles,
    /\.property-body:not\(\.checkout-view\) \.property-tab-panel\s*\{\s*overflow: hidden;/,
  );
});

test("entire-property privacy and room choice stay on one property page", () => {
  assert.match(propertySource, /No unrelated overnight guests/);
  assert.match(propertySource, /function selectEntireProperty\(option\)/);
  assert.match(propertySource, /function switchToRoomSelection\(\)/);
  assert.match(propertySource, /state\.entireSelection = null/);
});

test("room and entire-property choices disclose canonical occupancy and extra-person pricing", () => {
  assert.match(propertySource, /Base price includes/);
  assert.match(propertySource, /Maximum \$\{category\.maxOccupancy\} guests/);
  assert.match(propertySource, /extraAdultNightlyFromMinor/);
  assert.match(propertySource, /extraChildNightlyFromMinor/);
  assert.match(propertySource, /function renderRoomAllocationControls/);
  assert.match(propertySource, /total updates automatically/);
  assert.match(propertySource, /Maximum \$\{option\.maxOccupancy\} guests/);
  assert.match(propertySource, /Base price · includes/);
  assert.match(
    propertySource,
    /function renderEntireRoomAllocationControls\(option\)/,
  );
  assert.match(propertySource, /function entireAllocationValidation\(\)/);
  assert.match(propertySource, /function refreshEntireSelectionPricing\(\)/);
  assert.match(propertySource, /Allocate guests to rooms/);
  assert.match(propertySource, /Room allocation/);
  assert.match(propertySource, /function bookingVoucherSnapshot/);
  assert.match(propertySource, /function renderGuestVoucher/);
  assert.match(propertySource, /Maximum permitted/);
  assert.match(propertySource, /Print voucher/);
});

test("SmartStay discovery checks dates and exact group room count", () => {
  assert.match(homeSource, /async function matchGuestRequirements/);
  assert.match(homeSource, /room-recommendations/);
  assert.match(homeSource, /item\.roomCount === requestedRooms/);
  assert.match(homeSource, /smartstayCheckUnavailable/);
  assert.match(homeSource, /smartstay-price-summary/);
  assert.match(homeSource, /Excludes GST, fees and discounts/);
});

test("SmartStay checks exclusive availability before offering a villa upgrade", () => {
  assert.match(
    propertySource,
    /option\.productType === "FULL_PROPERTY" && option\.available/,
  );
  assert.match(propertySource, /availableEntireOption\(\)/);
  assert.match(propertySource, /Entire property unavailable for these dates/);
  assert.match(propertySource, /GST and fees confirmed next/);
});

test("SmartStay child ages are gathered and kept with the booking request", () => {
  assert.match(homeHtml, /id="smartstayChildAgeFields"/);
  assert.match(homeHtml, /id="adultsLabel">Adults</);
  assert.match(homeHtml, /id="childrenLabel">Children</);
  assert.match(homeSource, /function configureChildAgeFields/);
  assert.match(homeSource, /function selectedChildAges/);
  assert.match(homeSource, /childAges: selectedChildAges\(\)\.join/);
  assert.match(homeSource, /childAges,requestedRooms/);
  assert.match(propertySource, /query\.get\("childAges"\)/);
});

test("SmartStay offers exclusive accommodation when requested rooms cannot be matched", () => {
  assert.match(
    homeSource,
    /if \(!matches && !exclusive && allowsEntireProperty\(property\)\)/,
  );
  assert.match(homeSource, /suggestedMode = "villa"/);
  assert.match(
    homeSource,
    /requestedRooms > 6 && allowsEntireProperty\(property\)/,
  );
  assert.match(
    homeSource,
    /option\.productType === "FULL_PROPERTY" && option\.available/,
  );
});

test("SmartStay verifies party totals and labels exclusive-use fallback honestly", () => {
  assert.match(homeSource, /item\.adults === adults/);
  assert.match(homeSource, /item\.children === children/);
  assert.match(homeSource, /smartstayIsAlternative/);
  assert.match(homeSource, /This is an entire-property alternative/);
});

test("shared search dates must be calendar-valid and use local date defaults", () => {
  assert.ok(homeSource.includes("function isValidSearchDate(value)"));
  assert.ok(homeSource.includes("parsed.toISOString().slice(0, 10) === value"));
  assert.ok(homeSource.includes("if (!isValidSearchDate(value)) continue"));
  assert.ok(homeSource.includes('key === "arrivalDate" && value < input.min'));
  assert.ok(homeSource.includes("date.getFullYear()"));
  assert.ok(homeSource.includes("date.getMonth() + 1"));
});

test("shared search links restore numeric dates, guest counts and child ages", () => {
  assert.ok(homeSource.includes(String.raw`/^\d{4}-\d{2}-\d{2}$/`));
  assert.ok(homeSource.includes(String.raw`/^\d{1,2}$/`));
  assert.doesNotMatch(homeSource, /\\\\d/);
  assert.match(homeSource, /restoreSearchFromUrl\(initialSearch\)/);
  assert.match(homeSource, /field\.value = ages\[index\]/);
});

test("SmartStay returns customers to search with their guest preferences", () => {
  assert.match(homeSource, /function restoreSearchFromUrl/);
  assert.match(homeSource, /initialSearch\.set\("privateStay", "1"\)/);
  assert.match(propertySource, /function preservedSearchParams\(\)/);
  assert.match(propertySource, /link\.href = `\/stays\//);
  assert.doesNotMatch(
    propertySource,
    /querySelector\("#backToResults"\)\.href = "\/customer\/"/,
  );
});

test("SmartStay ranks verified room matches ahead of speculative options", () => {
  assert.match(homeSource, /properties\.sort\(\(a, b\) =>/);
  assert.match(homeSource, /a\.smartstayCheckUnavailable \? 1 : -1/);
  assert.match(homeSource, /a\.smartstayIsAlternative \? 1 : -1/);
  assert.match(homeSource, /return aAmount - bAmount/);
});

test("SmartStay restores complete destination and category context after viewing a stay", () => {
  assert.match(homeSource, /destination: form\.destination\.value\.trim\(\)/);
  assert.match(homeSource, /initialSearch\.get\("categoryId"\)/);
  assert.match(
    homeSource,
    /renderPropertyTypeFilter\(savedCategory, savedType \|\| ""\)/,
  );
  assert.match(
    propertySource,
    /"destination",[\s\S]*"categoryId",[\s\S]*"typeId"/,
  );
});

test("SmartStay premium cards retain accessible keyboard focus and reduced motion", () => {
  assert.match(discoveryStyles, /prefers-reduced-motion: reduce/);
  assert.match(discoveryStyles, /property-cta:focus-visible/);
  assert.match(discoveryStyles, /property-card:hover/);
});

test("SmartStay never loses published properties when taxonomy is incomplete", () => {
  assert.match(homeSource, /const categorizedIds = new Set/);
  assert.match(
    homeSource,
    /!categorizedIds\.has\(property\.propertyCategoryId\)/,
  );
  assert.match(homeSource, /More Wildleaf stays/);
  assert.match(homeSource, /renderedCount \+= uncategorized\.length/);
});

test("SmartStay separates verified property matches from unchecked stays", () => {
  assert.match(homeSource, /const verified = renderedCount - unverified/);
  assert.match(homeSource, /availability-matched/);
  assert.match(homeSource, /require.*verification/);
});

test("homepage categories, sliders and filters are generated from database taxonomy", () => {
  assert.match(homeHtml, /id="propertyCategory"[^>]*name="propertyCategoryId"/);
  assert.match(homeHtml, /id="propertyType"[^>]*name="propertyTypeId"/);
  assert.match(homeHtml, /class="property-category-sections"/);
  assert.match(homeSource, /\/v1\/public\/property-taxonomy/);
  assert.match(homeSource, /function renderPropertyTaxonomyFilters\(\)/);
  assert.match(homeSource, /categoryId \? \{categoryId\} : \{\}/);
  assert.match(homeSource, /typeId \? \{typeId\} : \{\}/);
  assert.match(homeSource, /category\.homepageHeading \|\| category\.name/);
  assert.match(homeSource, /if \(!categoryProperties\.length\) continue/);
  assert.match(homeSource, /property-category-rail/);
  assert.match(propertySource, /property\.propertyCategoryName/);
  assert.match(propertySource, /property\.propertyTypeName/);

  const combined = `${homeHtml}\n${homeSource}\n${entirePropertyHtml}\n${entirePropertySource}`;
  assert.doesNotMatch(
    combined,
    /Hotels & Resorts|Villas & Homestays|Cabins & Unique Stays|Glamping & Nature Stays|Heritage & Special Stays/,
  );
});

test("site root opens the room-discovery homepage by default", () => {
  const rootRedirect = firebaseConfig.hosting.redirects.find(
    (redirect) => redirect.source === "/",
  );
  assert.equal(rootRedirect?.destination, "/customer/");
  assert.doesNotMatch(rootRedirect?.destination || "", /mode=/);
});

test("clean destination property and checkout URLs resolve through Firebase Hosting", () => {
  const rewrites = firebaseConfig.hosting.rewrites;
  assert.equal(
    rewrites.find((rewrite) => rewrite.source === "/stays/*")?.destination,
    "/customer/destination.html",
  );
  assert.equal(
    rewrites.find((rewrite) => rewrite.source === "/stays/*/*")?.destination,
    "/customer/property.html",
  );
  assert.equal(
    rewrites.find((rewrite) => rewrite.source === "/checkout/*")?.destination,
    "/customer/property.html",
  );
  assert.match(destinationSource, /function propertyUrl\(property\)/);
  assert.match(
    destinationSource,
    /`\/stays\/\$\{encodeURIComponent\(slugify\(destinationLabel\(\)\)\)\}/,
  );
  assert.match(
    propertySource,
    /location\.assign\(`\/checkout\/\$\{encodeURIComponent\(publicSlug\)\}/,
  );
});

test("destination results support live filters and an always-editable search rail", () => {
  assert.match(destinationHtml, /data-mode="all"/);
  assert.match(destinationHtml, /data-mode="rooms"/);
  assert.match(destinationHtml, /data-mode="entire"/);
  assert.match(
    destinationHtml,
    /id="destinationSearchForm" class="destination-search-form"/,
  );
  assert.doesNotMatch(destinationHtml, /id="mobileSearchTrigger"/);
  assert.doesNotMatch(destinationHtml, />Change your search</);
  assert.match(destinationHtml, /class="destination-topbar"/);
  assert.doesNotMatch(destinationHtml, /id="destinationHero"/);
  assert.doesNotMatch(destinationHtml, /id="destinationGuide"/);
  assert.match(destinationSource, /function renderProperties\(\)/);
  assert.match(
    destinationSource,
    /\/v1\/public\/properties\/\$\{encodeURIComponent\(property\.publicSlug\)\}/,
  );
  assert.match(
    destinationSource,
    /property\.saleMode !== "FULL_PROPERTY_ONLY"/,
  );
  assert.match(
    destinationSource,
    /property\.saleMode === "FULL_PROPERTY_ONLY" \|\| property\.saleMode === "BOTH"/,
  );
  assert.match(
    destinationStyles,
    /Search is edited in place at every viewport/,
  );
  assert.match(
    destinationStyles,
    /\.destination-topbar\s*\{[\s\S]*grid-template-columns:/,
  );
  assert.match(
    destinationStyles,
    /\.destination-card\s*\{[\s\S]*grid-template-columns:/,
  );
  assert.match(destinationStyles, /@media \(max-width: 720px\)/);
  assert.match(
    destinationStyles,
    /\.destination-search-form\s*\{[\s\S]*position:\s*static;[\s\S]*visibility:\s*visible;/,
  );
  assert.doesNotMatch(destinationSource, /function openMobileSearch\(\)/);
});

test("homepage discovery removes redundant heading layers and keeps live categories primary", () => {
  assert.match(homeHtml, /id="destinationHeading">Destinations</);
  assert.doesNotMatch(homeHtml, /Pick a destination/);
  assert.doesNotMatch(homeHtml, /Stay collections/);
  assert.doesNotMatch(homeHtml, /Explore Wildleaf/);
  assert.match(
    homeSource,
    /element\("h2", "", category\.homepageHeading \|\| category\.name\)/,
  );
  assert.match(homeSource, /\.filter\(\(category\) => category\.enabled\)/);
  assert.doesNotMatch(homeSource, /homepageVisible/);
  assert.match(homeSource, /if \(!categoryProperties\.length\) continue/);
});

test("mobile homepage search stays inline and never opens a full-screen panel", () => {
  assert.doesNotMatch(homeHtml, /id="mobileSearchTrigger"/);
  assert.doesNotMatch(homeSource, /function openMobileSearch\(\)/);
  assert.match(
    discoveryStyles,
    /@media \(max-width: 820px\)[\s\S]*\.home-page \.search-card,[\s\S]*position:\s*absolute;[\s\S]*visibility:\s*visible;[\s\S]*pointer-events:\s*auto;/,
  );
  assert.match(
    discoveryStyles,
    /\.home-page \.home-hero::after,[\s\S]*\.home-search-open \.home-hero::after\s*\{[\s\S]*display:\s*none;/,
  );
});

test("managed homepage hero headline stays visually restrained across breakpoints", () => {
  assert.match(
    homeStyles,
    /\.home-page \.managed-hero \.hero-content h1\s*\{[\s\S]*max-width:\s*820px;[\s\S]*font-size:\s*clamp\(2\.8rem, 4\.8vw, 5rem\)/,
  );
  assert.match(
    homeStyles,
    /@media \(max-width: 820px\)[\s\S]*\.home-page \.managed-hero \.hero-content h1\s*\{[\s\S]*font-size:\s*clamp\(2\.15rem, 9\.4vw, 3\.35rem\)/,
  );
  assert.match(
    homeStyles,
    /@media \(max-width: 480px\)[\s\S]*\.home-page \.managed-hero \.hero-content h1\s*\{[\s\S]*font-size:\s*clamp\(1\.95rem, 9\.8vw, 2\.8rem\)/,
  );
});

test("homepage sections use subtle alternating surfaces to avoid a monotone scroll", () => {
  assert.match(homeStyles, /--wl-surface-warm:\s*#f7f2e9/);
  assert.match(homeStyles, /--wl-surface-sage:\s*#f1f5f0/);
  assert.match(homeStyles, /--wl-surface-stone:\s*#edf1eb/);
  assert.match(
    homeStyles,
    /\.destination-section\s*\{[\s\S]*background:\s*var\(--wl-surface-warm\)/,
  );
  assert.match(
    homeStyles,
    /\.property-category-section\s*\{[\s\S]*background:\s*var\(--wl-surface-sage\)/,
  );
  assert.match(
    homeStyles,
    /\.property-category-section:nth-child\(even\)\s*\{[\s\S]*background:\s*var\(--wl-surface-warm\)/,
  );
  assert.match(
    homeStyles,
    /\.home-page \.promise-section\s*\{[\s\S]*background:\s*var\(--wl-surface-stone\)/,
  );
});

test("Legacy entire-property catalogue remains available at its direct URL", () => {
  assert.doesNotMatch(homeHtml, /id="entirePropertyEntry"/);
  assert.match(entirePropertyHtml, /id="entirePropertyFilters"/);
  assert.match(entirePropertyHtml, /id="catalogDestination"/);
  assert.match(entirePropertyHtml, /id="catalogCategory"/);
  assert.match(entirePropertyHtml, /id="catalogType"/);
  assert.match(entirePropertySource, /\/v1\/public\/property-taxonomy/);
  assert.match(entirePropertySource, /\/v1\/public\/properties/);
  assert.match(
    entirePropertySource,
    /property\.saleMode === "FULL_PROPERTY_ONLY"/,
  );
  assert.match(entirePropertySource, /property\.saleMode === "BOTH"/);
  assert.match(
    entirePropertySource,
    /const locations = \[\.\.\.grouped\.keys\(\)\]\.sort\(collator\.compare\)/,
  );
  assert.match(
    entirePropertySource,
    /sort\(\(left, right\) => collator\.compare\(left\.name, right\.name\)\)/,
  );
  assert.match(
    entirePropertySource,
    /className = "catalog-location-section"|catalog-location-section/,
  );
  assert.match(entirePropertySource, /mode: "villa"/);
});

test("Entire Property page uses optional Super Admin marketing instead of permanent literature", () => {
  assert.match(entirePropertyHtml, /id="entirePropertyHero"/);
  assert.match(entirePropertyHtml, /id="entirePropertyHeroHeadline"/);
  assert.match(entirePropertyHtml, /id="entirePropertyHeroOffer"/);
  assert.match(entirePropertyHtml, /id="entirePropertyHeroCta"/);
  assert.doesNotMatch(entirePropertyHtml, /A place entirely your own/);
  assert.doesNotMatch(
    entirePropertyHtml,
    /Browse private-use Wildleaf stays by destination/,
  );
  assert.doesNotMatch(entirePropertyHtml, />Browse by destination</);
  assert.doesNotMatch(entirePropertyHtml, />Entire-property stays</);
  assert.match(entirePropertySource, /\/v1\/public\/homepage/);
  assert.match(entirePropertySource, /homepage\.entirePropertyHeroSlides/);
  assert.match(entirePropertySource, /function renderHero\(\)/);
  assert.match(entirePropertySource, /slide\.offerLabel/);
  assert.match(entirePropertySource, /slide\.ctaLabel && slide\.ctaHref/);
  assert.match(entirePropertySource, /hero\?\.classList\.add\("hidden"\)/);
});

test("property booking always uses one unified selector", () => {
  assert.match(propertyHtml, /id="bookingModeBadge"/);
  assert.doesNotMatch(propertyHtml, /id="unitCountField"/);
  assert.match(propertySource, /selectionType: null/);
  assert.match(propertySource, /state\.selectionType === "entire"/);
  assert.match(propertySource, /state\.selectionType = "rooms"/);
  assert.doesNotMatch(propertySource, /expectedProductType|state\.bookingMode/);
});

test("entire-property presentation explains the shared property clearly", () => {
  assert.match(
    propertySource,
    /Every active bedroom and shared space is reserved together/,
  );
  assert.doesNotMatch(propertySource, /villaBaseRate|separateVillaRate/);
});

test("property page loads inventory automatically and offers direct booking", () => {
  assert.doesNotMatch(propertyHtml, /id="availabilityButton"/);
  assert.doesNotMatch(propertyHtml, />\s*Check availability\s*</);
  assert.doesNotMatch(propertyHtml, /Available rooms and rates/);
  assert.match(propertyHtml, /class="[^"]*availability-form/);
  assert.match(
    propertySource,
    /searchAvailability\(\{ resetBooking: false \}\)/,
  );
  assert.match(propertySource, /function scheduleAvailabilitySearch\(\)/);
  assert.match(propertySource, /"Book now"/);
  assert.match(
    propertySource,
    /GST and any additional fees shown before payment/,
  );
  assert.doesNotMatch(
    propertySource,
    /GST and mandatory fees shown before payment/,
  );
  assert.match(propertySource, /async function startBooking\(option, button\)/);
  assert.match(
    propertySource,
    /await createHold\(null, \{ scrollToGuest: true \}\)/,
  );
  assert.doesNotMatch(propertySource, /"Get exact price"/);
});

test("property search defaults to today, one night, one room and two adults", () => {
  assert.match(propertySource, /const defaultArrival = today/);
  assert.match(propertySource, /: addDays\(arrival, 1\)/);
  assert.match(propertySource, /query\.get\("rooms"\) \|\| 1/);
  assert.match(propertySource, /query\.get\("adults"\) \|\| 2/);
});

test("hotel room categories are not repeated in the property summary", () => {
  assert.doesNotMatch(
    propertySource,
    /const card = element\("article", "room-category-summary"\)/,
  );
  assert.doesNotMatch(propertyHtml, /id="stayConfiguration"/);
  assert.match(propertySource, /function renderAboutTab\(property\)/);
});

test("available rates use OTA-style room facts and calendar-backed totals", () => {
  assert.match(propertySource, /ota-rate-card/);
  assert.match(propertySource, /category\.maxOccupancy/);
  assert.match(propertySource, /mealPlanLabel/);
  assert.match(propertySource, /option\.estimatedTotalMinor/);
  assert.match(
    propertySource,
    /GST and any additional fees shown before payment/,
  );
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
  assert.match(
    propertySource,
    /room-mixes\/\$\{state\.roomMixQuote\.id\}\/hold/,
  );
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
  assert.match(propertySource, /const roomCategoryMedia =/);
  assert.match(
    propertySource,
    /\.\.\.\(property\.media \|\| \[\]\), \.\.\.roomCategoryMedia/,
  );
  assert.match(propertySource, /media\.slice\(0, 5\)/);
  assert.match(propertySource, /gallery-count-/);
});

test("hotel rates are grouped into one horizontal shopping card per room category", () => {
  assert.match(propertyHtml, /room-category-rail/);
  assert.match(propertySource, /function groupRoomOptions\(options\)/);
  assert.match(
    propertySource,
    /function roomCategoryCard\(category, options, nights\)/,
  );
  assert.match(propertySource, /rate-plan-list/);
  assert.match(propertySource, /rate-plan-choice/);
  assert.match(propertySource, /mealPlanLabel\(option\.mealPlanCode\)/);
  assert.match(
    propertySource,
    /function renderRoomAllocationControls\(category, selection\)/,
  );
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
  assert.match(
    propertySource,
    /await createRoomMixHold\(\{ scrollToGuest: true \}\)/,
  );
  assert.match(
    propertySource,
    /await createHold\(null, \{ scrollToGuest: true \}\)/,
  );
});

test("Wildleaf Match stays out of simple searches and is collapsible for complex groups", () => {
  assert.match(propertyHtml, /<details\s+id="smartMatchSection"/);
  assert.match(propertySource, /const complexSearch =/);
  assert.match(
    propertySource,
    /requestedRooms > 1 \|\| totals\.children > 0 \|\| totals\.adults > 2/,
  );
  assert.match(propertySource, /smartMatchSection\.open = false/);
});

test("payment verification network failures keep a safe manual recovery message", () => {
  const polling = propertySource
    .split("function startStatusPolling() {")[1]
    .split("\nfunction stopStatusPolling")[0];
  assert.match(
    polling,
    /const checkedStatus = await refreshCheckoutStatus\(true\)/,
  );
  assert.match(polling, /if \(!checkedStatus && state\.pollAttempts >= 24\)/);
  assert.match(polling, /Wildleaf could not reach payment verification/);
});

test("terminal payment outcomes cannot be replaced by timeout messaging", () => {
  const polling = propertySource
    .split("function startStatusPolling() {")[1]
    .split("\nfunction stopStatusPolling")[0];
  assert.match(
    polling,
    /if \(!state\.polling\) return;[\s\S]*?if \(state\.pollAttempts >= 24\)/,
  );
});

test("exhausted payment polling shows an actionable manual recovery path", () => {
  const polling = propertySource
    .split("function startStatusPolling() {")[1]
    .split("\nfunction stopStatusPolling")[0];
  assert.match(polling, /state\.pollAttempts >= 24/);
  assert.match(polling, /Automatic payment checks have paused/);
  assert.match(polling, /use Check booking status to retry/);
  assert.match(
    polling,
    /Do not make another payment until the result is verified/,
  );
});

test("payment polling stops when reservation or payment identity changes", () => {
  const polling = propertySource
    .split("function startStatusPolling() {")[1]
    .split("\nfunction stopStatusPolling")[0];
  assert.match(
    polling,
    /const pollingReservationId = state\.session\.activeCheckout\?\.reservationId/,
  );
  assert.match(
    polling,
    /const pollingPaymentIntentId = state\.session\.activeCheckout\?\.paymentIntentId/,
  );
  assert.match(
    polling,
    /state\.session\.activeCheckout\?\.reservationId !== pollingReservationId/,
  );
  assert.match(polling, /stopStatusPolling\(\);[\s\S]*?return;/);
});

test("pending checkout recovery does not wait for live room discovery", () => {
  const loader = propertySource
    .split("async function loadProperty() {")[1]
    .split("\nfunction renderProperty")[0];
  assert.match(loader, /void searchAvailability\(\{ resetBooking: false \}\)/);
  assert.match(loader, /void searchRoomRecommendations\(\)/);
  assert.doesNotMatch(loader, /await Promise\.allSettled/);
  assert.ok(
    loader.indexOf("void searchRoomRecommendations()") <
      loader.indexOf("await refreshCheckoutStatus(true)"),
  );
});

test("page reload keeps a manual recovery path when checkout status is unreachable", () => {
  const load = propertySource
    .split("async function loadProperty() {")[1]
    .split("\nfunction renderProperty")[0];
  assert.match(load, /else if \(!status\)/);
  assert.match(
    load,
    /Wildleaf could not verify this reservation after the page reloaded/,
  );
  assert.match(load, /renderPendingStatus\([\s\S]*?false,/);
});

test("stale payment-status responses cannot overwrite another checkout", () => {
  const statusFlow = propertySource
    .split("async function refreshCheckoutStatus(quiet) {")[1]
    .split("\nfunction renderCheckoutOutcome")[0];
  assert.equal(
    (
      statusFlow.match(
        /state\.session\.activeCheckout\?\.reservationId !== active\.reservationId/g,
      ) || []
    ).length,
    2,
  );
  assert.match(
    statusFlow,
    /state\.session\.activeCheckout\?\.paymentIntentId !== active\.paymentIntentId/,
  );
});

test("pending Razorpay orders block a second checkout until canonical status is resolved", () => {
  const checkoutFlow = propertySource
    .split("async function beginCheckout(guestForm, button) {")[1]
    .split("\nfunction openRazorpay")[0];
  const guard = checkoutFlow.indexOf(
    "if (state.session.activeCheckout && !state.session.activeCheckout.outcome)",
  );
  const submit = checkoutFlow.indexOf(
    "const data = await apiRequest(checkoutPath",
  );
  assert.ok(guard >= 0 && guard < submit);
  assert.match(propertySource, /outcome: data\.outcome/);
  assert.match(checkoutFlow, /An earlier payment is still pending/);
  assert.match(checkoutFlow, /void refreshCheckoutStatus\(true\)/);
});

test("superseded checkout preserves pending booking but does not launch Razorpay", () => {
  const checkoutFlow = propertySource
    .split("async function beginCheckout(guestForm, button) {")[1]
    .split("\nfunction openRazorpay")[0];
  assert.match(
    checkoutFlow,
    /bookingSearchVersion !== state\.recommendationRequestVersion/,
  );
  assert.match(
    checkoutFlow,
    /selectionVersion !== state\.selectionPricingVersion/,
  );
  assert.match(checkoutFlow, /state\.session\.activeCheckout =/);
  assert.match(checkoutFlow, /Check its status before making another payment/);
  assert.match(checkoutFlow, /return;[\s\S]*?openRazorpay\(\)/);
});

test("manual room quotes cannot overwrite a changed room selection or search", () => {
  const manualFlow = propertySource
    .split("async function continueRoomSelection(button) {")[1]
    .split("\nfunction availabilityCard")[0];
  assert.match(
    manualFlow,
    /const selectionVersion = state\.selectionPricingVersion/,
  );
  assert.match(
    manualFlow,
    /const bookingSearchVersion = state\.recommendationRequestVersion/,
  );
  assert.equal(
    (
      manualFlow.match(
        /selectionVersion !== state\.selectionPricingVersion/g,
      ) || []
    ).length,
    3,
  );
});

test("stale standard and mixed-room holds cannot restore obsolete guest checkout", () => {
  for (const source of ["state.quote", "state.roomMixQuote"]) {
    assert.match(
      propertySource,
      new RegExp(
        "requestVersion !== state\\.recommendationRequestVersion\\s*\\|\\|\\s*" +
          source.replace(".", "\\.") +
          "\\?\\.id !== fingerprint",
      ),
    );
  }
});

test("promotion edits invalidate an in-flight recommended quote", () => {
  assert.match(
    propertySource,
    /form\.promotionCode\.addEventListener\("input", \(\) => \{[\s\S]*?state\.recommendationRequestVersion \+= 1;[\s\S]*?clearQuoteAndLater\(\)/,
  );
});

test("changing a booking removes persisted quotes and holds without losing payment recovery", () => {
  const clearFlow = propertySource
    .split("function clearQuoteAndLater() {")[1]
    .split("\nfunction showInlineMessage")[0];
  for (const field of ["quote", "quoteId", "roomMixQuote", "hold", "holdId"]) {
    assert.match(
      clearFlow,
      new RegExp("delete state\\.session\\." + field + ";"),
    );
  }
  assert.match(clearFlow, /saveBookingSession\(publicSlug, state\.session\)/);
  assert.doesNotMatch(clearFlow, /delete state\.session\.activeCheckout/);
});

test("delayed recommended quotes cannot restore an outdated booking after search edits", () => {
  assert.match(
    propertySource,
    /const bookingSearchVersion = state\.recommendationRequestVersion/,
  );
  assert.equal(
    (
      propertySource.match(
        /if \(bookingSearchVersion !== state\.recommendationRequestVersion\) return;/g,
      ) || []
    ).length,
    2,
  );
});

test("changing dates or guests immediately invalidates stale room recommendations", () => {
  assert.match(
    propertySource,
    /function clearResultsAfterSearchChange\(\) \{[\s\S]*?state\.recommendationRequestVersion \+= 1/,
  );
  assert.match(
    propertySource,
    /function clearResultsAfterSearchChange\(\) \{[\s\S]*?smartRecommendations\?\.replaceChildren\(\)/,
  );
});

test("room shopping keeps Razorpay verification server-side", () => {
  assert.doesNotMatch(propertySource, /razorpay_payment_id/);
  assert.doesNotMatch(propertySource, /razorpay_signature/);
});

test("liked horizontal room-card presentation remains the shopping baseline", () => {
  assert.match(propertyHtml, /room-category-rail/);
  assert.match(propertySource, /room-category-card ota-rate-card/);
  assert.match(propertySource, /room-category-visual/);
  assert.match(propertySource, /rate-plan-list/);
  assert.match(propertySource, /rate-plan-choice/);
  assert.match(propertySource, /room-allocation-section/);
  assert.match(propertyHtml, /id="selectionRibbon"/);
});

test("room quantity is selected per category while party totals remain shared", () => {
  assert.match(propertyHtml, /class="availability-form property-planner-form"/);
  assert.match(propertyHtml, /name="unitCount"[\s\S]{0,120}type="number"/);
  assert.match(propertyHtml, /name="adults"[\s\S]{0,120}type="number"/);
  assert.match(propertyHtml, /name="children"[\s\S]{0,120}type="number"/);
  assert.doesNotMatch(propertyHtml, /Choose how you would like to stay/);
  assert.match(propertySource, /state\.units = \[\s*\{\s*adults,/s);
  assert.match(
    propertySource,
    /state\.requestedRooms = clamp\(Number\(form\.unitCount\.value/,
  );
  assert.match(
    propertySource,
    /function changeRoomQuantity\(category, defaultOption, change\)/,
  );
  assert.match(propertySource, /room-quantity-picker/);
  assert.match(propertySource, /defaultRoomAllocation\(category\)/);
  assert.match(propertySource, /selectedPartyTotals\(\)/);
  assert.match(
    propertySource,
    /state\.requestedRooms - totalSelectedRooms\(\)/,
  );
  assert.match(
    propertySource,
    /Math\.ceil\(remainingAdults \/ remainingPlannedRooms\)/,
  );
});

test("multi-room shopping discovers categories independently and exposes live stock", () => {
  assert.match(propertySource, /function refreshCategoryAvailabilityCounts\(/);
  assert.match(propertySource, /function probeCategoryAvailability\(/);
  assert.match(propertySource, /function categoryAvailabilityLabel\(/);
  assert.match(propertySource, /room-stock-badge/);
  assert.match(propertySource, /Only 1 room available/);
  assert.match(propertySource, /rooms available/);
  assert.match(propertySource, /totalSelectedRooms\(\) >= 20/);
});

test("room allocation dynamically caps adults and occupancy-counting children", () => {
  assert.match(propertySource, /function roomAdultMaximum\(category, unit\)/);
  assert.match(propertySource, /function roomChildMaximum\(category, unit\)/);
  assert.match(propertySource, /function roomUnitValid\(category, unit\)/);
  assert.match(
    propertySource,
    /integerSelect\(unit\.adults, 1, adultMaximum\)/,
  );
  assert.match(
    propertySource,
    /integerSelect\(unit\.childAges\.length, 0, childMaximum\)/,
  );
  assert.match(propertySource, /children\.disabled = childMaximum === 0/);
  assert.match(propertySource, /ageOption\.disabled = !roomUnitValid/);
  assert.match(propertySource, /unit\.adults < 1/);
});

test("search occupancy is guidance while inventory and room capacity remain enforced", () => {
  assert.match(propertySource, /function partyMismatchMessage\(/);
  assert.match(propertySource, /valid: true,[\s\S]*?warning: mismatch/);
  assert.match(propertySource, /Different from your search:/);
  assert.match(propertySource, /roomCount !== state\.requestedRooms/);
  assert.match(
    propertySource,
    /the selected child ages do not match your search/,
  );
  assert.match(
    propertySource,
    /selectionContinue\.disabled = !validation\.valid/,
  );
  assert.match(propertySource, /exceeds its maximum occupancy/);
  assert.match(propertySource, /currently available/);
  assert.match(propertySource, /One selected room is no longer available/);
});

test("infant occupancy classification is isolated from exact quote child ages", () => {
  assert.match(propertySource, /function infantMaxAgeForUi\(\)/);
  assert.match(propertySource, /state\.property\?\.guestAgePolicy/);
  assert.match(propertySource, /return 5/);
  assert.match(propertySource, /function availabilityChildrenForUnit\(unit\)/);
  assert.match(propertySource, /childAges: \[\.\.\.unit\.childAges\]/);
});

test("Wildleaf Match sends the guest requested room count instead of inventing extra rooms", () => {
  assert.match(propertySource, /const requestedRooms = requestedRoomCount\(\)/);
  assert.match(propertySource, /requestedRooms,/);
  assert.match(propertySource, /!complexSearch \|\| requestedRooms > 6/);
});

test("homepage uses one directly editable search rail across viewports", () => {
  assert.doesNotMatch(homeHtml, /id="mobileSearchTrigger"/);
  assert.match(homeHtml, /class="search-guest-group"/);
  assert.match(homeHtml, /id="destinationRail"/);
  assert.match(homeHtml, /home-hero hero-search-only/);
  assert.doesNotMatch(homeHtml, /Find a stay that feels right\./);
  assert.match(
    discoveryStyles,
    /@media \(min-width: 821px\)[\s\S]*height:\s*64px;[\s\S]*grid-template-columns:[\s\S]*112px;[\s\S]*min-height:\s*42px;/,
  );
  assert.doesNotMatch(homeSource, /function openMobileSearch\(\)/);
  assert.doesNotMatch(homeSource, /function closeMobileSearch\(\)/);
  assert.match(homeSource, /function updateMobileSearchSummary\(\)/);
  assert.match(homeSource, /function renderDestinations\(destinations\)/);
});

test("managed homepage heroes can be image-only without automatic fallback copy", () => {
  assert.match(homeSource, /heroEyebrow\.classList\.add\("hidden"\)/);
  assert.match(
    homeSource,
    /heroHeadline\.classList\.toggle\("hidden", !slide\.headline\)/,
  );
  assert.match(
    homeSource,
    /heroSubtitle\.classList\.toggle\("hidden", !slide\.subtitle\)/,
  );
  assert.doesNotMatch(
    homeSource,
    /Handpicked stays with live availability and secure booking\./,
  );
});

test("room category photo action uses the room's own published media collection", () => {
  assert.match(propertySource, /category\.media \|\| \[\]/);
  assert.match(
    propertySource,
    /function openPhotoCollection\(media, index = 0\)/,
  );
  assert.match(propertySource, /state\.photoMedia/);
  assert.match(propertySource, /openPhotoCollection\(roomMedia, 0\)/);
});

test("homepage supports managed hero campaigns and destination photography without changing booking search", () => {
  assert.match(homeHtml, /id="heroImage"/);
  assert.match(homeHtml, /id="heroOffer"/);
  assert.match(homeHtml, /id="heroSliderControls"/);
  assert.match(homeHtml, /id="heroDots"/);
  assert.match(homeSource, /\/v1\/public\/homepage/);
  assert.match(homeSource, /function renderManagedHero\(index\)/);
  assert.match(homeSource, /function resetHeroTimer\(\)/);
  assert.match(homeSource, /homepageMediaUrl\(destination\.imageId\)/);
  assert.match(homeSource, /destination-card-image/);
  assert.doesNotMatch(homeSource, /function updateHero\(/);
  assert.match(homeSource, /hero\.classList\.remove\("hero-search-only"\)/);
  assert.match(homeSource, /loadDestinations\(\)/);
});

test("customer booking pages use one compact, functional mobile search interface", () => {
  for (const html of [homeHtml, destinationHtml, propertyHtml]) {
    assert.match(html, /mobile-search\.css/);
  }
  for (const source of [homeSource, destinationSource, propertySource]) {
    assert.match(source, /mountMobileSearch/);
  }
  assert.match(mobileSearchSource, /openDatePanel/);
  assert.match(mobileSearchSource, /Check-in/);
  assert.match(mobileSearchSource, /Check-out/);
  assert.match(mobileSearchSource, /Kids/);
  assert.match(
    mobileSearchSource,
    /dispatchEvent\(new Event\(type, \{ bubbles: true \}\)\)/,
  );
  assert.match(mobileSearchStyles, /@media \(max-width: 760px\)/);
  assert.match(
    mobileSearchStyles,
    /@media \(max-width: 760px\)[\s\S]*\.mobile-search-source\s*\{[\s\S]*display:\s*none\s*!important/,
  );
  assert.match(
    mobileSearchStyles,
    /\.property-quick-facts\s*\{[\s\S]*display:\s*none/,
  );
  assert.match(propertyHtml, /id="propertyMobileType"/);
  assert.match(propertySource, /propertyMobileType/);
  assert.match(destinationSource, /destinationMobileSearch\.refresh\(\)/);
});
