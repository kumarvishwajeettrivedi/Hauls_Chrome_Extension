// "gesture" is written by the sender, so it cannot be the only thing standing between a compromised content script and "erase / sign out and clear". These checks pin the UI side of that design (guard.js and background.js are covered in guard.test.js / tracker.test.js).
const assert = require("assert"), fs = require("fs"), path = require("path"); let n = 0;
const rd = f => fs.readFileSync(path.join(__dirname, "../../extension", f), "utf8"), ok = (c, m) => { assert.ok(c, m); n++; };
const content = rd("content.js"), options = rd("options.js"), html = rd("options.html");
ok(/navigator\.userActivation \? navigator\.userActivation\.isActive/.test(content) && !/hasBeenActive/.test(content), "content.js reads isActive (sticky hasBeenActive is true after any earlier click)");
ok(!/type: "delete-data"/.test(content) && !/type: "signout", clear: true/.test(content), "the shop-page panel never sends the erasing messages itself");
ok(/type: "open-options", at: "delete"/.test(content) && /type: "open-options", at: "signout-clear"/.test(content), "the panel opens the confirming page instead");
ok(/type: "delete-data"/.test(options) && /type: "signout", clear: true/.test(options) && /location\.hash/.test(options), "the settings page sends them after its own confirm click");
ok(/id="confirm"/.test(html) && /id="cfgo"/.test(html) && /id="cfno"/.test(html), "options.html has the confirm card with a confirm and a cancel button");
// the whole-account export is the same design: the shop-page panel only opens Settings (#export); the file is made there
ok(!/type: "export-data"/.test(content) && !/hauls-my-data/.test(content), "the shop-page panel never asks for the export itself");
ok(/type: "open-options", at: "export"/.test(content), "the panel's Export button opens Settings at #export");
ok(/type: "export-data"/.test(options) && /hauls-my-data\.json/.test(options) && /export: \[/.test(options) && /id="export"/.test(html), "Settings makes the export file (button and #export confirm)");
// activation must be read at the click, not after an await (isActive lapses after ~5 s)
ok(/openAccount\(g = gesture\(\)\)/.test(content) && /clickG = gesture\(\)/.test(content) && /gesture: clickG/.test(content), "account refresh and the iplocate fallback reuse the click's activation");
console.log(`destructive: ${n} passed, 0 failed`);
