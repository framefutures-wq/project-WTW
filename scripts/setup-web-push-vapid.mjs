import { spawnSync } from "node:child_process";

if (process.argv[2] !== "--production") {
  console.error("Refusing to generate a VAPID secret without --production.");
  process.exit(1);
}
const encode = (value) => Buffer.from(value, "base64url").toString("base64url");
const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const publicJwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
const privateJwk = await crypto.subtle.exportKey("jwk", keys.privateKey);
if (!publicJwk.x || !publicJwk.y || !privateJwk.d) throw new Error("VAPID key generation failed");
const publicKey = Buffer.concat([Buffer.from([4]), Buffer.from(publicJwk.x, "base64url"), Buffer.from(publicJwk.y, "base64url")]).toString("base64url");
const privateKey = encode(privateJwk.d);
const result = spawnSync("npx", ["wrangler", "secret", "put", "WEB_PUSH_VAPID_PRIVATE_KEY", "--config", "wrangler.production.jsonc"], { input: privateKey, encoding: "utf8", stdio: ["pipe", "inherit", "inherit"] });
if (result.status !== 0) process.exit(result.status ?? 1);
// The private key is intentionally never printed, written, or returned.
console.log(publicKey);
