// Derives the pinned extension public key (for manifest.key) and the resulting extension ID from keys/hauls-dev.pem.
// A fixed ID is needed so the OAuth redirect URL (https://<id>.chromiumapp.org/) never changes.
const { execSync } = require("child_process"), crypto = require("crypto"), fs = require("fs"), path = require("path");
const root = path.join(__dirname, ".."), pem = path.join(root, "keys/hauls-dev.pem");
const der = execSync(`openssl rsa -in "${pem}" -pubout -outform DER 2>/dev/null`);
const id = [...crypto.createHash("sha256").update(der).digest().subarray(0, 16)].map(b => String.fromCharCode(97 + (b >> 4)) + String.fromCharCode(97 + (b & 15))).join("");
const mpath = path.join(root, "extension/manifest.json"), m = JSON.parse(fs.readFileSync(mpath, "utf8"));
m.key = der.toString("base64"); fs.writeFileSync(mpath, JSON.stringify(m, null, 2));
console.log(JSON.stringify({ extensionId: id, redirectUrl: `https://${id}.chromiumapp.org/` }));
