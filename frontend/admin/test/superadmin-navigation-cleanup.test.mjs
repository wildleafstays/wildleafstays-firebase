import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const js=await readFile(new URL("../admin.js", import.meta.url),"utf8");
const css=await readFile(new URL("../experience.css", import.meta.url),"utf8");
const block=js.slice(js.indexOf("const choices = [", js.indexOf("function setupCommandCenterWorkspaces")),js.indexOf("  for (const [label, description, target] of choices)",js.indexOf("function setupCommandCenterWorkspaces")));
test("Super Admin Command Center excludes owner-specific workspaces",()=>{
 for(const label of ["My properties","Property reservations","Rates & inventory","Property dashboard","Business setup"]) {
   assert.ok(!block.includes('["'+label+'"'),label);
 }
 for(const label of ["All Hotels","Property approvals & submitted hotels","Website studio"]) assert.ok(block.includes(label),label);
});
test("one header on super admin screens while keeping back button",()=>{
 assert.match(css,/\.portal\.command-center-mode:has\(\.screen:not\(#controlScreen\):not\(\.hidden\)\) \.workspace-head \{\s*display: none !important/);
 assert.match(js,/button\.textContent = "← Back to Command Center"/);
 assert.match(js,/button\.addEventListener\("click", \(\) => void run\(\(\) => showScreen\("control"\)\)\)/);
});
