import { describe, expect, it } from "vitest";
import { listRowHasForbiddenSecretFields, mapWalletList, WALLET_ITEM_LIST_COLUMNS, type WalletItemRow } from "./wallet";
import { HUNDIE_UNTRACKED_SLUG } from "@/lib/settings/wallet-mock";

describe("wallet list payload", () => {
  it("select list is last4/expiry only — never pan, cvv, routing, or ciphertext", () => {
    expect(WALLET_ITEM_LIST_COLUMNS).toMatch(/last4/);
    expect(WALLET_ITEM_LIST_COLUMNS).not.toMatch(/pan|cvv|routing|ciphertext|accountNumber/i);
    const fixture = Object.fromEntries(WALLET_ITEM_LIST_COLUMNS.split(",").map((col) => [col.trim(), "x"]));
    expect(listRowHasForbiddenSecretFields(fixture)).toBe(false);
    expect(listRowHasForbiddenSecretFields({ ...fixture, pan: "4111" })).toBe(true);
    expect(listRowHasForbiddenSecretFields({ ...fixture, cvv: "123" })).toBe(true);
    expect(listRowHasForbiddenSecretFields({ ...fixture, routing: "110000000" })).toBe(true);
  });

  it("maps linked and untracked rows without secret fields", () => {
    const items: WalletItemRow[] = [
      {
        id: "w1",
        account_id: "acct-1",
        kind: "card",
        display_name: "Amex",
        slug: "amex-alex-personal",
        issuer_parser: "amex",
        account_type: "credit_card",
        last4: "0005",
        expiry: "09/27",
        network: "amex",
      },
      {
        id: "w2",
        account_id: null,
        kind: "card",
        display_name: "Spare card",
        slug: "spare-card",
        issuer_parser: "unknown",
        account_type: "credit_card",
        last4: "4242",
        expiry: null,
        network: null,
      },
    ];
    const mapped = mapWalletList({
      items,
      accounts: [
        {
          id: "acct-1",
          display_name: "Amex Alex Personal",
          slug: "amex-alex-personal",
          account_type: "credit_card",
          issuer_parser: "amex",
          mixed_use: false,
          date_rules: [],
          default_entity: { id: "e-personal", name: "Personal", slug: "personal" },
        },
      ],
      vaultItemIds: ["w1"],
    });
    expect(mapped[0]).toMatchObject({
      last4: "0005",
      ledgerAccount: true,
      hasVault: true,
      accountId: "acct-1",
    });
    expect(mapped[1]).toMatchObject({
      ledgerAccount: false,
      accountId: null,
      initialChipId: HUNDIE_UNTRACKED_SLUG,
      hasVault: false,
    });
    expect(JSON.stringify(mapped)).not.toMatch(/"pan"|"cvv"|"routing"|"ciphertext"/i);
  });
});
