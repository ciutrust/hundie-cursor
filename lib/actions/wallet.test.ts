import { randomBytes } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { makeFakeSupabase } from "../../tests/helpers/fake-supabase.mjs";
import { decryptVaultPayload } from "@/lib/wallet/vault";

beforeAll(() => {
  process.env.WALLET_VAULT_ENC_KEY = randomBytes(32).toString("base64");
});

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

function setup(initial: Record<string, unknown[]> = {}) {
  const client = makeFakeSupabase({
    wallet_items: [],
    wallet_secrets: [],
    ...initial,
  }) as { from: unknown; db: Record<string, any[]> };
  vi.doMock("@/lib/auth/require-user", () => ({
    requireUser: async () => ({ error: null, user: { id: "u1", email: "u@x.com" }, supabase: client }),
  }));
  vi.doMock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => client }));
  vi.doMock("next/cache", () => ({ revalidatePath: () => {} }));
  return { db: client.db };
}

describe("createUntrackedWalletItem", () => {
  it("leaves account_id null and ledgerAccount false", async () => {
    const { db } = setup();
    const { createUntrackedWalletItem } = await import("./wallet");
    const res = await createUntrackedWalletItem({
      kind: "card",
      displayName: "Spare Amex",
      secrets: { kind: "card", pan: "378282246310005", expiry: "12/29", cvv: "4310", network: "amex" },
    });
    expect(res).toMatchObject({ success: true, accountId: null });
    expect(db.wallet_items).toHaveLength(1);
    expect(db.wallet_items[0].account_id).toBeNull();
    expect(db.wallet_items[0].last4).toBe("0005");
    expect(db.wallet_items[0]).not.toHaveProperty("cvv");
    expect(db.wallet_items[0]).not.toHaveProperty("pan");
  });
});

describe("saveWalletSecrets", () => {
  it("derives last4 from PAN and encrypts CVV in the vault payload", async () => {
    const { db } = setup({
      wallet_items: [
        {
          id: "w1",
          account_id: "acct-1",
          kind: "card",
          account_type: "credit_card",
          display_name: "Amex",
          last4: null,
          expiry: null,
          network: null,
        },
      ],
    });
    const { saveWalletSecrets } = await import("./wallet");
    const res = await saveWalletSecrets({
      walletItemId: "w1",
      displayName: "Amex Alex Personal",
      secrets: { kind: "card", pan: "378282246310005", expiry: "09/27", cvv: "1234", network: "amex" },
    });
    expect(res).toMatchObject({ success: true, last4: "0005", expiry: "09/27", network: "amex" });
    expect(db.wallet_items[0].last4).toBe("0005");
    expect(db.wallet_items[0].display_name).toBe("Amex Alex Personal");
    expect(db.wallet_items[0]).not.toHaveProperty("cvv");
    expect(db.wallet_items[0]).not.toHaveProperty("pan");
    expect(db.wallet_secrets).toHaveLength(1);
    expect(db.wallet_secrets[0].ciphertext).not.toContain("1234");
    expect(db.wallet_secrets[0].ciphertext).not.toContain("378282246310005");
    expect(decryptVaultPayload(db.wallet_secrets[0].ciphertext)).toEqual({
      pan: "378282246310005",
      cvv: "1234",
    });
  });
});
