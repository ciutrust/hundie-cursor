import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, test } from "vitest";
import { decryptSecret, encryptSecret, keyFingerprint } from "./secret-box";

beforeAll(() => {
  process.env.PLAID_TOKEN_ENC_KEY = randomBytes(32).toString("base64");
});

describe("secret-box AES-256-GCM", () => {
  test("round-trips a token", () => {
    const token = "access-sandbox-abc123";
    expect(decryptSecret(encryptSecret(token))).toBe(token);
  });

  test("ciphertext is not the plaintext and varies per call (random IV)", () => {
    const a = encryptSecret("same");
    const b = encryptSecret("same");
    expect(a).not.toBe("same");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("same");
    expect(decryptSecret(b)).toBe("same");
  });

  test("rejects a tampered ciphertext (GCM auth tag)", () => {
    const c = encryptSecret("secret");
    const buf = Buffer.from(c, "base64");
    buf[buf.length - 1] ^= 0xff; // flip a bit in the ciphertext
    expect(() => decryptSecret(buf.toString("base64"))).toThrow();
  });

  test("S10: rejects a too-short payload with a clear error before OpenSSL", () => {
    expect(() => decryptSecret("")).toThrow(/too short/);
    expect(() => decryptSecret(Buffer.from([1, 2, 3]).toString("base64"))).toThrow(/too short/);
  });

  test("keyFingerprint is stable for a key and changes when the key changes", () => {
    const saved = process.env.PLAID_TOKEN_ENC_KEY;
    process.env.PLAID_TOKEN_ENC_KEY = randomBytes(32).toString("base64");
    const fp1 = keyFingerprint();
    expect(fp1).toBe(keyFingerprint());
    process.env.PLAID_TOKEN_ENC_KEY = randomBytes(32).toString("base64");
    expect(keyFingerprint()).not.toBe(fp1);
    process.env.PLAID_TOKEN_ENC_KEY = saved;
  });

  test("throws when the key is missing or wrong length", () => {
    const saved = process.env.PLAID_TOKEN_ENC_KEY;
    process.env.PLAID_TOKEN_ENC_KEY = "";
    expect(() => encryptSecret("x")).toThrow();
    process.env.PLAID_TOKEN_ENC_KEY = Buffer.from("tooshort").toString("base64");
    expect(() => encryptSecret("x")).toThrow();
    process.env.PLAID_TOKEN_ENC_KEY = saved;
  });
});
