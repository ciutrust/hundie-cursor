import type { AccountDateRule } from "@/lib/queries/accounts";

export const WALLET_NO_FLIP_SELECTOR = "[data-no-flip]";

export const HUNDIE_UNTRACKED_SLUG = "hundie-untracked";
export const NOT_TRACKED_SLUG = "not-tracked";

export type EntityChip = { id: string; name: string; slug: string };

export const UNTRACKED_CHIP_OPTIONS: EntityChip[] = [
  { id: HUNDIE_UNTRACKED_SLUG, name: "Hundie Untracked", slug: HUNDIE_UNTRACKED_SLUG },
  { id: NOT_TRACKED_SLUG, name: "Not tracked", slug: NOT_TRACKED_SLUG },
];

export const ENTITY_CHIP_LABELS: Record<string, string> = {
  gbsl: "GBSL",
  keller: "Keller",
  personal: "Personal",
  "acaa-austin": "Austin ACAA",
  pflugerville: "Pflugerville",
  [HUNDIE_UNTRACKED_SLUG]: "Hundie Untracked",
  [NOT_TRACKED_SLUG]: "Not tracked",
};

export type CardNetwork = "visa" | "mastercard" | "amex";

export type CardSecrets = {
  kind: "card";
  pan: string;
  expiry: string;
  cvv: string;
  network: CardNetwork;
};

export type BankSecrets = {
  kind: "bank";
  routing: string;
  accountNumber: string;
  notes: string;
};

export type WalletSecrets = CardSecrets | BankSecrets;

export type WalletItem = {
  id: string;
  accountId: string | null;
  slug: string;
  displayName: string;
  accountType: string;
  issuerParser: string;
  mixedUse: boolean;
  dateRules: AccountDateRule[];
  defaultEntity: { id: string; name: string; slug: string } | null;
  ledgerAccount: boolean;
  initialChipId: string;
  last4: string | null;
  expiry: string | null;
  network: CardNetwork | null;
  hasVault: boolean;
  kind: "card" | "bank";
};

export type CardProduct =
  | "quicksilver"
  | "capone-platinum"
  | "capone-spark"
  | "amex-blue"
  | "amex-gold"
  | "chase-united"
  | "chase"
  | "citi-aadvantage"
  | "citi-strata"
  | "wells-signify"
  | "wells-personal"
  | "wells-business-line"
  | "wells-fargo"
  | "bank";

export type CardProductLines = { primary: string; secondary?: string };

export type IssuerTheme = {
  face: string;
  chip: string;
  muted: string;
};

export const WF_SIGNIFY_SLUGS = new Set(["wf-gbsl-cc", "wf-gbsl-claudia-cc", "wf-keller-services-cc"]);

export function cardProduct(item: Pick<WalletItem, "slug" | "issuerParser" | "accountType">): CardProduct {
  if (item.accountType !== "credit_card") return "bank";
  if (item.slug.includes("quicksilver")) return "quicksilver";
  if (item.slug.includes("platinum")) return "capone-platinum";
  if (item.issuerParser === "capital_one" && item.slug.includes("acaa")) return "capone-spark";
  if (item.issuerParser === "amex" && item.slug.includes("gold")) return "amex-gold";
  if (item.issuerParser === "amex") return "amex-blue";
  if (item.issuerParser === "chase" && item.slug.includes("united")) return "chase-united";
  if (item.issuerParser === "chase") return "chase";
  if (item.issuerParser === "citi" && item.slug.includes("aadvantage")) return "citi-aadvantage";
  if (item.issuerParser === "citi") return "citi-strata";
  if (item.slug === "wf-personal-cc") return "wells-personal";
  if (item.slug === "wf-gbsl-business-line") return "wells-business-line";
  if (WF_SIGNIFY_SLUGS.has(item.slug)) return "wells-signify";
  if (item.issuerParser === "wells_fargo") return "wells-fargo";
  if (item.issuerParser === "capital_one") return "capone-platinum";
  return "bank";
}

export function cardProductLines(item: Pick<WalletItem, "slug" | "issuerParser" | "accountType">): CardProductLines | null {
  switch (cardProduct(item)) {
    case "quicksilver":
      return { primary: "QUICKSILVER" };
    case "capone-platinum":
      return { primary: "PLATINUM" };
    case "capone-spark":
      return { primary: "SPARK", secondary: "BUSINESS" };
    case "amex-gold":
      return { primary: "GOLD" };
    case "chase-united":
      return { primary: "UNITED", secondary: "EXPLORER" };
    case "chase":
      return { primary: item.slug.includes("sapphire") ? "SAPPHIRE" : "CHASE" };
    case "citi-aadvantage":
      return { primary: "AADVANTAGE", secondary: "EXECUTIVE" };
    case "citi-strata":
      return { primary: "STRATA" };
    case "wells-signify":
      return { primary: "SIGNIFY", secondary: "BUSINESS CASH" };
    case "wells-personal":
      return { primary: "REWARDS" };
    case "wells-business-line":
      return { primary: "BUSINESS", secondary: "LINE" };
    case "wells-fargo":
      return { primary: "ACTIVE CASH" };
    case "bank":
      return { primary: item.accountType === "savings" ? "SAVINGS" : "CHECKING" };
    default:
      return null;
  }
}

export const CARD_FACE_IMAGES: Partial<Record<CardProduct, string>> = {
  quicksilver: "/wallet/cap-one-quicksilver.png",
  "capone-platinum": "/wallet/cap-one-platinum.png",
  "capone-spark": "/wallet/cap-one-spark-acaa.png",
  "amex-blue": "/wallet/amex-blue.jpg",
  "chase-united": "/wallet/chase-united.png",
  "citi-aadvantage": "/wallet/citi-aadvantage.jpg",
  "citi-strata": "/wallet/citi-strata.jpg",
  "wells-signify": "/wallet/wf-signify.jpg",
  "wells-personal": "/wallet/wf-personal.jpg",
  "wells-business-line": "/wallet/wf-business-line.jpg",
};

export function cardFaceImage(product: CardProduct): string | null {
  return CARD_FACE_IMAGES[product] ?? null;
}

export function cardFaceClass(product: CardProduct): string {
  switch (product) {
    case "quicksilver":
      return "bg-gradient-to-b from-[#3f464d] via-[#8b929a] to-[#d5d9de] text-white";
    case "capone-platinum":
      return "bg-[#061a38] text-white";
    case "capone-spark":
      return "bg-[radial-gradient(ellipse_at_center,#1a7a48_0%,#0c3f2c_48%,#04180f_100%)] text-white";
    case "amex-blue":
      return "bg-gradient-to-br from-[#1a4f9a] via-[#123a78] to-[#071e48] text-white";
    case "amex-gold":
      return "bg-gradient-to-br from-[#d4b46a] via-[#b0893a] to-[#6e5420] text-white";
    case "chase-united":
      return "bg-gradient-to-br from-[#041433] via-[#0A2342] to-[#1a4f9a] text-white";
    case "chase":
      return "bg-gradient-to-br from-[#062a5a] via-[#0A2342] to-[#031428] text-white";
    case "citi-aadvantage":
      return "bg-[#2a2d32] text-white";
    case "citi-strata":
      return "bg-[#d8dce0] text-[#1f2428]";
    case "wells-signify":
      return "bg-[#1a1c1e] text-white";
    case "wells-personal":
      return "bg-gradient-to-br from-[#3a2a1c] via-[#1c1410] to-[#0d0a08] text-white";
    case "wells-business-line":
      return "bg-gradient-to-b from-[#b8b8b8] via-[#8a8a8a] to-[#5c5c5c] text-white";
    case "wells-fargo":
      return "bg-gradient-to-b from-[#c42328] via-[#B31E22] to-[#7a1216] text-white";
    case "bank":
      return "bg-gradient-to-br from-[#7a1216] via-[#B31E22] to-[#4a0c10] text-white";
  }
}

export function emvChipTone(product: CardProduct): "silver" | "gold" {
  return product === "chase" || product === "wells-fargo" || product === "wells-personal" || product === "bank"
    ? "gold"
    : "silver";
}

export const ISSUER_THEMES: Record<string, IssuerTheme> = {
  chase: {
    face: "bg-[#0A2342] text-white",
    chip: "from-[#E8D5A3] to-[#C4A35A]",
    muted: "text-white/70",
  },
  amex: {
    face: "bg-gradient-to-br from-[#006FCF] to-[#012169] text-white",
    chip: "from-[#F3E2B8] to-[#C9A227]",
    muted: "text-white/75",
  },
  citi: {
    face: "bg-[#101820] text-white",
    chip: "from-[#E8D5A3] to-[#C4A35A]",
    muted: "text-white/70",
  },
  capital_one: {
    face: "bg-zinc-950 text-white",
    chip: "from-[#E8D5A3] to-[#C4A35A]",
    muted: "text-white/65",
  },
  wells_fargo: {
    face: "bg-[#B31E22] text-white",
    chip: "from-[#F5E6A8] to-[#D4A017]",
    muted: "text-white/80",
  },
  unknown: {
    face: "bg-zinc-800 text-white",
    chip: "from-[#E8D5A3] to-[#C4A35A]",
    muted: "text-white/70",
  },
};

export function isBankAccountType(accountType: string): boolean {
  return accountType === "checking" || accountType === "savings";
}

export function partitionWalletItems(items: WalletItem[]): { cards: WalletItem[]; accounts: WalletItem[] } {
  const cards: WalletItem[] = [];
  const accounts: WalletItem[] = [];
  for (const item of items) {
    if (isBankAccountType(item.accountType)) accounts.push(item);
    else cards.push(item);
  }
  return { cards, accounts };
}

export function revealKindForAccountType(accountType: string): WalletSecrets["kind"] {
  return isBankAccountType(accountType) ? "bank" : "card";
}

export function issuerTheme(issuerParser: string): IssuerTheme {
  return ISSUER_THEMES[issuerParser] ?? ISSUER_THEMES.unknown;
}

export function chipLabel(entity: EntityChip): string {
  return ENTITY_CHIP_LABELS[entity.slug] ?? entity.name;
}

export function entityChipOptions(entities: EntityChip[]): EntityChip[] {
  const seen = new Set(entities.map((entity) => entity.slug));
  const extras = UNTRACKED_CHIP_OPTIONS.filter((option) => !seen.has(option.slug));
  return [...entities, ...extras];
}

export function lastFour(digits: string): string {
  const compact = digits.replace(/\D/g, "");
  return compact.slice(-4).padStart(4, "0");
}

export function formatPan(pan: string, network: CardNetwork): string {
  const compact = pan.replace(/\D/g, "");
  if (network === "amex") {
    return `${compact.slice(0, 4)} ${compact.slice(4, 10)} ${compact.slice(10)}`.trim();
  }
  return compact.replace(/(.{4})/g, "$1 ").trim();
}

/** Digits only, optionally capped — for mobile numeric card fields. */
export function digitsOnly(raw: string, maxLength?: number): string {
  const digits = raw.replace(/\D/g, "");
  return maxLength != null ? digits.slice(0, maxLength) : digits;
}

/** Format PAN for input: digits only, spaced by network, max 19 digits. */
export function formatPanInput(raw: string): string {
  const compact = digitsOnly(raw, 19);
  return formatPan(compact, inferCardNetwork(compact));
}

/** Format expiry as MM/YY while typing digits only (e.g. 1228 → 12/28). */
export function formatExpiryInput(raw: string): string {
  const digits = digitsOnly(raw, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

export function displayLast4(last4: string | null | undefined): string {
  const digits = (last4 ?? "").replace(/\D/g, "").slice(-4);
  return digits || "••••";
}

export function formatMaskedPan(pan: string, network: CardNetwork): string {
  return formatMaskedPanLast4(lastFour(pan), network);
}

export function formatMaskedPanLast4(last4: string | null | undefined, network: CardNetwork): string {
  const four = displayLast4(last4);
  if (four === "••••") {
    return network === "amex" ? "•••• •••••• ••••" : "•••• •••• •••• ••••";
  }
  if (network === "amex") return `•••• •••••• ${four}`;
  return `•••• •••• •••• ${four}`;
}

export function formatMaskedAccount(accountNumber: string): string {
  return formatMaskedAccountLast4(lastFour(accountNumber));
}

export function formatMaskedAccountLast4(last4: string | null | undefined): string {
  return `•••• ${displayLast4(last4)}`;
}

export function maskCvvForNetwork(network: CardNetwork | null): string {
  return network === "amex" ? "••••" : "•••";
}

export function formatMaskedRouting(routing: string): string {
  return formatMaskedRoutingLast4(lastFour(routing));
}

export function formatMaskedRoutingLast4(last4: string | null | undefined): string {
  const four = displayLast4(last4);
  return four === "••••" ? "•••••••••" : `•••••${four}`;
}

export function maskExpiry(): string {
  return "••/••";
}

export function maskCvv(cvv: string): string {
  return "•".repeat(Math.max(cvv.length, 3));
}

export function maskNotes(): string {
  return "••••••••";
}

export function nextUnmaskedCard(currentCardId: string | null, cardId: string): string | null {
  return currentCardId === cardId ? null : cardId;
}

export function unmaskedAfterOpeningCard(currentCardId: string | null, openingCardId: string): string | null {
  if (!currentCardId || currentCardId === openingCardId) return currentCardId;
  return null;
}

export function frontLastFour(secrets: WalletSecrets): string {
  return secrets.kind === "bank" ? lastFour(secrets.accountNumber) : lastFour(secrets.pan);
}

export function findEntity(entities: EntityChip[], id: string): EntityChip | undefined {
  return entities.find((entity) => entity.id === id);
}

export function canPersistEntityId(entityId: string, entities: EntityChip[]): boolean {
  return entities.some((entity) => entity.id === entityId);
}

function hasClosest(target: unknown): target is { closest: (selector: string) => unknown } {
  return !!target && typeof (target as { closest?: unknown }).closest === "function";
}

export function clickShouldToggleReveal(target: unknown): boolean {
  if (!hasClosest(target)) return true;
  return target.closest(WALLET_NO_FLIP_SELECTOR) == null;
}

export function inferCardNetwork(pan: string): CardNetwork {
  const compact = pan.replace(/\D/g, "");
  if (compact.startsWith("34") || compact.startsWith("37")) return "amex";
  if (compact.startsWith("5")) return "mastercard";
  return "visa";
}

export function inferIssuerParser(displayName: string, kind: "card" | "bank"): string {
  const name = displayName.toLowerCase();
  if (name.includes("amex") || name.includes("american express")) return "amex";
  if (name.includes("chase") || name.includes("united") || name.includes("sapphire")) return "chase";
  if (name.includes("citi") || name.includes("aadvantage") || name.includes("strata")) return "citi";
  if (name.includes("capital") || name.includes("cap one") || name.includes("quicksilver") || name.includes("spark")) {
    return "capital_one";
  }
  if (name.includes("wells") || name.includes("wf") || kind === "bank") return "wells_fargo";
  return "unknown";
}

export function slugifyWalletName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "wallet-item";
}

export type AddedWalletDraft = {
  kind: "card" | "checking" | "savings";
  displayName: string;
  secrets: WalletSecrets;
};

export function createAddedWalletItem(draft: AddedWalletDraft, id: string): WalletItem {
  const isCard = draft.kind === "card";
  const kind = isCard ? "card" : "bank";
  const last4 =
    draft.secrets.kind === "card" ? lastFour(draft.secrets.pan) : lastFour(draft.secrets.accountNumber);
  return {
    id,
    accountId: null,
    slug: `${slugifyWalletName(draft.displayName)}-${id.replace(/[^a-z0-9]/gi, "").slice(-6)}`,
    displayName: draft.displayName.trim() || (isCard ? "New card" : "New account"),
    accountType: isCard ? "credit_card" : draft.kind,
    issuerParser: inferIssuerParser(draft.displayName, kind),
    mixedUse: false,
    dateRules: [],
    defaultEntity: null,
    ledgerAccount: false,
    initialChipId: HUNDIE_UNTRACKED_SLUG,
    last4,
    expiry: draft.secrets.kind === "card" ? draft.secrets.expiry : null,
    network: draft.secrets.kind === "card" ? draft.secrets.network : null,
    hasVault: true,
    kind,
  };
}
