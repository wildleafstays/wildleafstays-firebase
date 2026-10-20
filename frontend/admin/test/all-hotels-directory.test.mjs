import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const js=await readFile(new URL("../admin.js",import.meta.url),"utf8");
const state=await readFile(new URL("../portal-state.js",import.meta.url),"utf8");
const html=await readFile(new URL("../index.html",import.meta.url),"utf8");
test("all hotels is a protected single-hub read-only workspace",()=>{
  assert.match(state,/platformRoles \|\| \[\]\)\.includes\("SUPER_ADMIN"\)\) screens\.push\("hotels"\)/);
  assert.match(js,/loadHotelDirectory\(false\)/);
  assert.match(js,/\/v1\/platform\/hotels\/directory/);
  assert.match(js,/details\.className = "command-hotel"/);
  assert.match(js,/other !== details/);
  assert.match(html,/id="hotelDirectoryList"/);
  assert.match(html,/id="loadMoreHotels"/);
});
