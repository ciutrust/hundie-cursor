import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * AES-256-GCM "secret box" for encrypting secrets at rest (Plaid tokens, wallet numbers).
 *
 * The key lives only in server env and is read at call time so it is never bundled to the
 * browser. GCM is authenticated encryption — a tampered ciphertext fails to decrypt.
 * Format: base64( iv[12] | tag[16] | ciphertext ).
 *
 * Pass `WALLET_VAULT_ENC_KEY` for the wallet vault. Plaid callers omit the name and keep
 * using `PLAID_TOKEN_ENC_KEY` so rotating Connections tokens cannot lock the wallet.
 */

const IV_BYTES = 12;
const TAG_BYTES = 16;

export const PLAID_TOKEN_KEY_ENV = "PLAID_TOKEN_ENC_KEY";
export const WALLET_VAULT_KEY_ENV = "WALLET_VAULT_ENC_KEY";

function getKey(envName: string): Buffer {
  const raw = process.env[envName];
  if (!raw) throw new Error(`${envName} is not set`);
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(`${envName} must decode to 32 bytes (base64-encoded)`);
  }
  return key;
}

export function encryptSecret(plaintext: string, envName: string = PLAID_TOKEN_KEY_ENV): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", getKey(envName), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

/**
 * A non-secret fingerprint of the current key (sha256, truncated). Record it: if it ever changes,
 * the stored secrets can no longer be decrypted.
 */
export function keyFingerprint(envName: string = PLAID_TOKEN_KEY_ENV): string {
  return createHash("sha256").update(getKey(envName)).digest("hex").slice(0, 12);
}

export function decryptSecret(payload: string, envName: string = PLAID_TOKEN_KEY_ENV): string {
  const buf = Buffer.from(payload, "base64");
  // S10: reject a too-short payload with a clear error before createDecipheriv, instead of feeding
  // garbage IV/tag into OpenSSL (which surfaces as an opaque low-level error).
  if (buf.length < IV_BYTES + TAG_BYTES) {
    throw new Error("invalid ciphertext payload: too short");
  }
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", getKey(envName), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
