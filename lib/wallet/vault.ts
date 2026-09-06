import { decryptSecret, encryptSecret, keyFingerprint, WALLET_VAULT_KEY_ENV } from "@/lib/crypto/secret-box";
import { inferCardNetwork, lastFour, type CardNetwork, type WalletSecrets } from "@/lib/settings/wallet-mock";

export type VaultPayload = {
  pan?: string;
  cvv?: string;
  routing?: string;
  accountNumber?: string;
  notes?: string;
};

export function encryptVaultPayload(payload: VaultPayload): { ciphertext: string; fingerprint: string } {
  return {
    ciphertext: encryptSecret(JSON.stringify(payload), WALLET_VAULT_KEY_ENV),
    fingerprint: keyFingerprint(WALLET_VAULT_KEY_ENV),
  };
}

export function decryptVaultPayload(ciphertext: string): VaultPayload {
  const parsed: unknown = JSON.parse(decryptSecret(ciphertext, WALLET_VAULT_KEY_ENV));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid vault payload");
  }
  const row = parsed as Record<string, unknown>;
  return {
    pan: readOptionalString(row.pan),
    cvv: readOptionalString(row.cvv),
    routing: readOptionalString(row.routing),
    accountNumber: readOptionalString(row.accountNumber),
    notes: readOptionalString(row.notes),
  };
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function vaultPayloadFromSecrets(secrets: WalletSecrets): VaultPayload {
  if (secrets.kind === "card") {
    return {
      pan: digitsOnly(secrets.pan) || undefined,
      cvv: secrets.cvv.trim() || undefined,
    };
  }
  return {
    routing: digitsOnly(secrets.routing) || undefined,
    accountNumber: digitsOnly(secrets.accountNumber) || undefined,
    notes: secrets.notes.trim() || undefined,
  };
}

export function vaultPayloadIsEmpty(payload: VaultPayload): boolean {
  return !payload.pan && !payload.cvv && !payload.routing && !payload.accountNumber && !payload.notes;
}

export function last4FromPayload(payload: VaultPayload, kind: "card" | "bank"): string | null {
  const source = kind === "card" ? payload.pan : payload.accountNumber;
  return source ? last4FromDigits(source) : null;
}

export function last4FromDigits(digits: string): string | null {
  const compact = digits.replace(/\D/g, "");
  if (!compact) return null;
  return lastFour(compact);
}

export function secretsFromVaultPayload(
  kind: "card" | "bank",
  payload: VaultPayload,
  extras: { expiry?: string | null; network?: CardNetwork | null },
): WalletSecrets {
  if (kind === "card") {
    const pan = payload.pan ?? "";
    return {
      kind: "card",
      pan,
      expiry: extras.expiry ?? "",
      cvv: payload.cvv ?? "",
      network: extras.network ?? (pan ? inferCardNetwork(pan) : "visa"),
    };
  }
  return {
    kind: "bank",
    routing: payload.routing ?? "",
    accountNumber: payload.accountNumber ?? "",
    notes: payload.notes ?? "",
  };
}

export function emptySecretsForKind(
  kind: "card" | "bank",
  extras: { expiry?: string | null; network?: CardNetwork | null } = {},
): WalletSecrets {
  return secretsFromVaultPayload(kind, {}, extras);
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}
