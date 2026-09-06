import { randomBytes } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  decryptVaultPayload,
  encryptVaultPayload,
  last4FromPayload,
  vaultPayloadFromSecrets,
} from "./vault";

describe("wallet vault payload", () => {
  test("round-trips PAN and CVV", () => {
    process.env.WALLET_VAULT_ENC_KEY = randomBytes(32).toString("base64");
    const payload = vaultPayloadFromSecrets({
      kind: "card",
      pan: "4111111111114242",
      expiry: "12/28",
      cvv: "424",
      network: "visa",
    });
    const box = encryptVaultPayload(payload);
    expect(box.ciphertext).not.toContain("4111111111114242");
    expect(box.ciphertext).not.toContain("424");
    expect(decryptVaultPayload(box.ciphertext)).toEqual({
      pan: "4111111111114242",
      cvv: "424",
    });
    expect(last4FromPayload(payload, "card")).toBe("4242");
  });

  test("wrong key cannot decrypt", () => {
    process.env.WALLET_VAULT_ENC_KEY = randomBytes(32).toString("base64");
    const box = encryptVaultPayload({ pan: "4111111111114242", cvv: "123" });
    process.env.WALLET_VAULT_ENC_KEY = randomBytes(32).toString("base64");
    expect(() => decryptVaultPayload(box.ciphertext)).toThrow();
  });
});
