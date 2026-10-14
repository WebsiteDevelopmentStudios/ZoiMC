import fs from "node:fs";
import path from "node:path";

const file = path.join(
  process.cwd(),
  "node_modules",
  "nethernet",
  "src",
  "signalling",
  "sdpIdentity.js"
);

const original = "const key = crypto.createPublicKey({ key: claims?.cpk, format: 'jwk' })";
const replacement = [
  "const cpk = claims?.cpk",
  "  // Geyser/BDS sends cpk as base64-encoded DER SPKI, not a JWK object.",
  "  const key = typeof cpk === 'string'",
  "    ? crypto.createPublicKey({ key: Buffer.from(cpk, 'base64'), format: 'der', type: 'spki' })",
  "    : crypto.createPublicKey({ key: cpk, format: 'jwk' })"
].join("\n");

if (!fs.existsSync(file)) {
  console.error("NetherNet identity patch: expected dependency file was not found:", file);
  process.exit(1);
}

const source = fs.readFileSync(file, "utf8");
if (source.includes(replacement)) {
  console.log("NetherNet identity key-format fix is already applied.");
} else if (source.includes(original)) {
  fs.writeFileSync(file, source.replace(original, replacement));
  console.log("Applied NetherNet cpk DER/SPKI identity key-format fix.");
} else {
  console.error("NetherNet identity patch: expected source line was not found; refusing to modify an unknown version.");
  process.exit(1);
}
