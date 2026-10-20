import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const js=await readFile(new URL("../admin.js",import.meta.url),"utf8");
const css=await readFile(new URL("../experience.css",import.meta.url),"utf8");
test("super admin uses one Command Center with back action and no sidebar",()=>{
 assert.match(js,/commandBackButton/);
 assert.match(js,/showScreen\("control"\)/);
 assert.match(js,/portal\.classList\.toggle\("command-center-mode", isSuperAdmin\)/);
 assert.match(css,/\.portal\.command-center-mode > \.sidebar \{ display: none !important; \}/);
 assert.match(js,/target\.append\(accountControls\)/);
 assert.match(js,/Property approvals & submitted hotels/);
 assert.match(js,/Website studio/);
 assert.match(js,/Rates & inventory/);
});
