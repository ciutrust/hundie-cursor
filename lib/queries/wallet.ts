import { requireUser } from "@/lib/auth/require-user";
import type { AccountWithEntity } from "@/lib/queries/accounts";
import { getAccountsWithEntities } from "@/lib/queries/accounts";
import {
  HUNDIE_UNTRACKED_SLUG,
  NOT_TRACKED_SLUG,
  isBankAccountType,
  type CardNetwork,
  type WalletItem,
} from "@/lib/settings/wallet-mock";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/** Columns that may appear in the Accounts page payload. Never include ciphertext or PAN/CVV. */
export const WALLET_ITEM_LIST_COLUMNS =
  "id, account_id, kind, display_name, slug, issuer_parser, account_type, last4, expiry, network";

export type WalletItemRow = {
  id: string;
  account_id: string | null;
  kind: "card" | "bank";
  display_name: string;
  slug: string;
  issuer_parser: string;
  account_type: string;
  last4: string | null;
  expiry: string | null;
  network: string | null;
};

export function parseCardNetwork(value: string | null | undefined): CardNetwork | null {
  if (value === "visa" || value === "mastercard" || value === "amex") return value;
  return null;
}

export function mapWalletList(input: {
  items: WalletItemRow[];
  accounts: AccountWithEntity[];
  vaultItemIds: string[];
}): WalletItem[] {
  const accountsById = new Map(input.accounts.map((account) => [account.id, account]));
  const vaultIds = new Set(input.vaultItemIds);
  return input.items.map((row) => {
    const account = row.account_id ? accountsById.get(row.account_id) ?? null : null;
    const defaultEntity = account?.default_entity ?? null;
    return {
      id: row.id,
      accountId: row.account_id,
      slug: row.slug,
      displayName: row.display_name,
      accountType: row.account_type,
      issuerParser: row.issuer_parser,
      mixedUse: account?.mixed_use ?? false,
      dateRules: account?.date_rules ?? [],
      defaultEntity,
      ledgerAccount: Boolean(row.account_id),
      initialChipId: defaultEntity?.id ?? (row.account_id ? NOT_TRACKED_SLUG : HUNDIE_UNTRACKED_SLUG),
      last4: row.last4,
      expiry: row.expiry,
      network: parseCardNetwork(row.network),
      hasVault: vaultIds.has(row.id),
      kind: isBankAccountType(row.account_type) ? "bank" : "card",
    };
  });
}

export function listRowHasForbiddenSecretFields(row: Record<string, unknown>): boolean {
  const keys = Object.keys(row);
  return keys.some((key) => /pan|cvv|routing|ciphertext|accountNumber|account_number/i.test(key));
}

/**
 * Wallet display rows via the service-role client (RLS deny-all). Returns last4/expiry only —
 * ciphertext never leaves this module.
 */
export async function getWalletItems(): Promise<WalletItem[]> {
  const { error: authError } = await requireUser();
  if (authError) return [];

  const admin = createServiceRoleClient();
  const [{ data: items, error: itemsError }, { data: vaultRows, error: vaultError }, accounts] = await Promise.all([
    admin.from("wallet_items").select(WALLET_ITEM_LIST_COLUMNS).order("display_name"),
    admin.from("wallet_secrets").select("wallet_item_id"),
    getAccountsWithEntities(),
  ]);
  if (itemsError) throw itemsError;
  if (vaultError) throw vaultError;

  return mapWalletList({
    items: (items ?? []) as WalletItemRow[],
    accounts,
    vaultItemIds: (vaultRows ?? []).map((row: { wallet_item_id: string }) => row.wallet_item_id),
  });
}
