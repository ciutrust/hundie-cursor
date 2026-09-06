"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import {
  emptySecretsForKind,
  encryptVaultPayload,
  last4FromPayload,
  secretsFromVaultPayload,
  vaultPayloadFromSecrets,
  vaultPayloadIsEmpty,
  decryptVaultPayload,
} from "@/lib/wallet/vault";
import { inferCardNetwork, inferIssuerParser, isBankAccountType, slugifyWalletName, type WalletSecrets } from "@/lib/settings/wallet-mock";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const GENERIC_SAVE_ERROR = "Could not save wallet item.";
const GENERIC_REVEAL_ERROR = "Could not reveal wallet numbers.";

export type CreateUntrackedWalletInput = {
  kind: "card" | "checking" | "savings";
  displayName: string;
  secrets: WalletSecrets;
};

export async function createUntrackedWalletItem(input: CreateUntrackedWalletInput) {
  const auth = await requireUser();
  if (auth.error) return { error: auth.error };

  const displayName = input.displayName.trim();
  if (!displayName) return { error: "Name is required." };

  const isCard = input.kind === "card";
  const accountType = isCard ? "credit_card" : input.kind;
  const kind = isBankAccountType(accountType) ? "bank" : "card";
  const payload = vaultPayloadFromSecrets(input.secrets);
  const expiry = input.secrets.kind === "card" ? input.secrets.expiry.trim() || null : null;
  const network = input.secrets.kind === "card" ? inferCardNetwork(input.secrets.pan) : null;
  const last4 = last4FromPayload(payload, kind);

  const admin = createServiceRoleClient();
  const { data: inserted, error: insertError } = await admin
    .from("wallet_items")
    .insert({
      account_id: null,
      kind,
      display_name: displayName,
      slug: uniqueWalletSlug(displayName),
      issuer_parser: inferIssuerParser(displayName, kind),
      account_type: accountType,
      last4,
      expiry,
      network,
      updated_at: new Date().toISOString(),
    })
    .select("id, account_id")
    .single();

  if (insertError || !inserted) {
    return { error: GENERIC_SAVE_ERROR };
  }

  if (!vaultPayloadIsEmpty(payload)) {
    try {
      const box = encryptVaultPayload(payload);
      const { error: secretError } = await admin.from("wallet_secrets").insert({
        wallet_item_id: inserted.id,
        ciphertext: box.ciphertext,
        key_fingerprint: box.fingerprint,
        updated_at: new Date().toISOString(),
        updated_by: auth.user.id,
      });
      if (secretError) return { error: GENERIC_SAVE_ERROR };
    } catch {
      return { error: GENERIC_SAVE_ERROR };
    }
  }

  revalidatePath("/settings/accounts");
  return { success: true as const, id: inserted.id as string, accountId: null as string | null };
}

export async function saveWalletSecrets(input: {
  walletItemId: string;
  displayName: string;
  secrets: WalletSecrets;
}) {
  const auth = await requireUser();
  if (auth.error) return { error: auth.error };

  const displayName = input.displayName.trim();
  if (!displayName) return { error: "Name is required." };

  const admin = createServiceRoleClient();
  const { data: item, error: itemError } = await admin
    .from("wallet_items")
    .select("id, kind, account_type")
    .eq("id", input.walletItemId)
    .maybeSingle();
  if (itemError || !item) return { error: GENERIC_SAVE_ERROR };

  const kind = item.kind === "bank" || isBankAccountType(item.account_type) ? "bank" : "card";
  if (input.secrets.kind !== kind) return { error: GENERIC_SAVE_ERROR };

  const payload = vaultPayloadFromSecrets(input.secrets);
  const expiry = input.secrets.kind === "card" ? input.secrets.expiry.trim() || null : null;
  const network = input.secrets.kind === "card" ? inferCardNetwork(input.secrets.pan) : null;
  const last4 = last4FromPayload(payload, kind);

  // Explicit columns only — never persist cvv/pan/routing on wallet_items.
  const { error: updateError } = await admin
    .from("wallet_items")
    .update({
      display_name: displayName,
      last4,
      expiry,
      network,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.walletItemId);
  if (updateError) return { error: GENERIC_SAVE_ERROR };

  const { data: existing } = await admin
    .from("wallet_secrets")
    .select("wallet_item_id")
    .eq("wallet_item_id", input.walletItemId)
    .maybeSingle();

  if (vaultPayloadIsEmpty(payload)) {
    if (existing) {
      const { error: deleteError } = await admin.from("wallet_secrets").delete().eq("wallet_item_id", input.walletItemId);
      if (deleteError) return { error: GENERIC_SAVE_ERROR };
    }
  } else {
    let box: { ciphertext: string; fingerprint: string };
    try {
      box = encryptVaultPayload(payload);
    } catch {
      return { error: GENERIC_SAVE_ERROR };
    }
    const secretRow = {
      ciphertext: box.ciphertext,
      key_fingerprint: box.fingerprint,
      updated_at: new Date().toISOString(),
      updated_by: auth.user.id,
    };
    if (existing) {
      const { error: secretError } = await admin
        .from("wallet_secrets")
        .update(secretRow)
        .eq("wallet_item_id", input.walletItemId);
      if (secretError) return { error: GENERIC_SAVE_ERROR };
    } else {
      const { error: secretError } = await admin.from("wallet_secrets").insert({
        wallet_item_id: input.walletItemId,
        ...secretRow,
      });
      if (secretError) return { error: GENERIC_SAVE_ERROR };
    }
  }

  revalidatePath("/settings/accounts");
  return { success: true as const, last4, expiry, network };
}

export async function revealWalletSecrets(walletItemId: string) {
  const auth = await requireUser();
  if (auth.error) return { error: auth.error };

  const admin = createServiceRoleClient();
  const { data: item, error: itemError } = await admin
    .from("wallet_items")
    .select("id, kind, account_type, expiry, network")
    .eq("id", walletItemId)
    .maybeSingle();
  if (itemError || !item) return { error: GENERIC_REVEAL_ERROR };

  const kind = item.kind === "bank" || isBankAccountType(item.account_type) ? "bank" : "card";
  const extras = {
    expiry: typeof item.expiry === "string" ? item.expiry : null,
    network: item.network === "visa" || item.network === "mastercard" || item.network === "amex" ? item.network : null,
  };

  const { data: secret, error: secretError } = await admin
    .from("wallet_secrets")
    .select("ciphertext")
    .eq("wallet_item_id", walletItemId)
    .maybeSingle();
  if (secretError) return { error: GENERIC_REVEAL_ERROR };
  if (!secret?.ciphertext) {
    return { secrets: emptySecretsForKind(kind, extras) };
  }

  try {
    const payload = decryptVaultPayload(secret.ciphertext);
    return { secrets: secretsFromVaultPayload(kind, payload, extras) };
  } catch {
    return { error: GENERIC_REVEAL_ERROR };
  }
}

function uniqueWalletSlug(name: string): string {
  const base = slugifyWalletName(name);
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  return `${base}-${suffix}`;
}
