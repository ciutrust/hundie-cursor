import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WalletCard } from "@/components/settings/wallet-card";
import { WalletEditPanel } from "@/components/settings/wallet-edit-dialog";
import { Dialog } from "@/components/ui/dialog";
import {
  canPersistEntityId,
  cardFaceImage,
  cardProduct,
  cardProductLines,
  clickShouldToggleReveal,
  createAddedWalletItem,
  entityChipOptions,
  formatMaskedPan,
  HUNDIE_UNTRACKED_SLUG,
  lastFour,
  partitionWalletItems,
  revealKindForAccountType,
  unmaskedAfterOpeningCard,
  type EntityChip,
  type WalletItem,
  type WalletSecrets,
} from "@/lib/settings/wallet-mock";

const entities: EntityChip[] = [
  { id: "e-gbsl", name: "GBSL, LLC", slug: "gbsl" },
  { id: "e-personal", name: "Personal", slug: "personal" },
];

const creditSecrets: WalletSecrets = {
  kind: "card",
  pan: "378282246310005",
  expiry: "09/27",
  cvv: "1234",
  network: "amex",
};

const bankSecrets: WalletSecrets = {
  kind: "bank",
  routing: "110000000",
  accountNumber: "000111222333",
  notes: "Operating account",
};

const creditItem: WalletItem = {
  id: "acct-amex",
  accountId: "ledger-amex",
  slug: "amex-alex-personal",
  displayName: "Amex Alex Personal",
  accountType: "credit_card",
  issuerParser: "amex",
  mixedUse: false,
  dateRules: [],
  defaultEntity: { id: "e-personal", name: "Personal", slug: "personal" },
  ledgerAccount: true,
  initialChipId: "e-personal",
  last4: "0005",
  expiry: "09/27",
  network: "amex",
  hasVault: true,
  kind: "card",
};

const bankItem: WalletItem = {
  id: "acct-checking",
  accountId: "ledger-checking",
  slug: "wf-gbsl-checking",
  displayName: "WF GBSL Checking",
  accountType: "checking",
  issuerParser: "wells_fargo",
  mixedUse: false,
  dateRules: [],
  defaultEntity: { id: "e-gbsl", name: "GBSL, LLC", slug: "gbsl" },
  ledgerAccount: true,
  initialChipId: "e-gbsl",
  last4: "2333",
  expiry: null,
  network: null,
  hasVault: true,
  kind: "bank",
};

const untrackedItem: WalletItem = {
  id: "wallet-only-amex-gold",
  accountId: null,
  slug: "wallet-only-amex-gold",
  displayName: "Amex Gold — wallet only",
  accountType: "credit_card",
  issuerParser: "amex",
  mixedUse: false,
  dateRules: [],
  defaultEntity: null,
  ledgerAccount: false,
  initialChipId: HUNDIE_UNTRACKED_SLUG,
  last4: "8431",
  expiry: "12/29",
  network: "amex",
  hasVault: true,
  kind: "card",
};

function faceHtml(html: string, face: "front" | "back"): string {
  const start = html.indexOf(`data-face="${face}"`);
  if (start < 0) return "";
  if (face === "front") {
    const end = html.indexOf("</button>", start);
    return html.slice(start, end + "</button>".length);
  }
  return html.slice(start);
}

function renderEdit(item: WalletItem, secrets: WalletSecrets) {
  return renderToStaticMarkup(
    <Dialog open>
      <WalletEditPanel
        item={item}
        secrets={secrets}
        entities={entityChipOptions(entities)}
        classifiableEntities={entities}
        savedEntityId={item.initialChipId}
        dateRules={[]}
        onSave={() => undefined}
      />
    </Dialog>,
  );
}

function renderCard(item: WalletItem, flipped = false, secretsRevealed = false, secrets?: WalletSecrets) {
  return renderToStaticMarkup(
    <WalletCard
      item={item}
      entities={entityChipOptions(entities)}
      classifiableEntities={entities}
      defaultFlipped={flipped}
      secretsRevealed={secretsRevealed}
      secrets={secrets}
    />,
  );
}

describe("wallet display helpers", () => {
  test("credit last four and masked PAN do not require the full number in the page payload", () => {
    expect(creditItem.last4).toBe("0005");
    expect(formatMaskedPan(creditSecrets.pan, "amex")).toBe("•••• •••••• 0005");
    expect(revealKindForAccountType("savings")).toBe("bank");
    expect(revealKindForAccountType("credit_card")).toBe("card");
  });

  test("bank last four comes from the account number", () => {
    expect(lastFour(bankSecrets.accountNumber)).toBe("2333");
    expect(bankItem.last4).toBe("2333");
  });
});

describe("entity picker", () => {
  test("options include Hundie Untracked and Not tracked", () => {
    const chips = entityChipOptions(entities);
    expect(chips.map((chip) => chip.slug)).toEqual(["gbsl", "personal", "hundie-untracked", "not-tracked"]);
  });

  test("only classifiable entity ids persist", () => {
    expect(canPersistEntityId("e-personal", entities)).toBe(true);
    expect(canPersistEntityId("hundie-untracked", entities)).toBe(false);
  });

  test("cards and bank accounts stay in separate groups", () => {
    const { cards, accounts } = partitionWalletItems([creditItem, bankItem, untrackedItem]);
    expect(cards.map((item) => item.id)).toEqual([creditItem.id, untrackedItem.id]);
    expect(accounts.map((item) => item.id)).toEqual([bankItem.id]);
  });
});

describe("click vs controls", () => {
  test("copy, entity, and rules clicks do not flip", () => {
    expect(clickShouldToggleReveal({ closest: (selector: string) => (selector === "[data-no-flip]" ? {} : null) })).toBe(
      false,
    );
  });

  test("card chrome click flips", () => {
    expect(clickShouldToggleReveal({ closest: () => null })).toBe(true);
    expect(clickShouldToggleReveal(null)).toBe(true);
  });

  test("opening another card is a different id", () => {
    expect(unmaskedAfterOpeningCard("card-a", "card-b")).toBeNull();
    expect(unmaskedAfterOpeningCard("card-a", "card-a")).toBe("card-a");
  });
});

describe("card faces", () => {
  test("Austin ACAA uses Spark Business, not a generic green card", () => {
    const acaa = { ...creditItem, slug: "cap-one-acaa-austin", issuerParser: "capital_one" };
    expect(cardProduct(acaa)).toBe("capone-spark");
    expect(cardProductLines(acaa)).toEqual({ primary: "SPARK", secondary: "BUSINESS" });
    expect(cardFaceImage(cardProduct(acaa))).toBe("/wallet/cap-one-spark-acaa.png");
  });

  test("Platinum, Quicksilver, Chase United, and Citi photos map by product", () => {
    const platinum = { ...creditItem, slug: "cap-one-alex-platinum", issuerParser: "capital_one" };
    const quicksilver = { ...creditItem, slug: "cap-one-quicksilver-claudia", issuerParser: "capital_one" };
    const united = { ...creditItem, slug: "united-chase-claudia", issuerParser: "chase" };
    const aadvantage = { ...creditItem, slug: "citi-aadvantage-alex", issuerParser: "citi" };
    const strata = { ...creditItem, slug: "citi-strata-claudia", issuerParser: "citi" };
    expect(cardFaceImage(cardProduct(platinum))).toBe("/wallet/cap-one-platinum.png");
    expect(cardFaceImage(cardProduct(quicksilver))).toBe("/wallet/cap-one-quicksilver.png");
    expect(cardProduct(united)).toBe("chase-united");
    expect(cardFaceImage(cardProduct(united))).toBe("/wallet/chase-united.png");
    expect(cardProduct(aadvantage)).toBe("citi-aadvantage");
    expect(cardFaceImage(cardProduct(aadvantage))).toBe("/wallet/citi-aadvantage.jpg");
    expect(cardProduct(strata)).toBe("citi-strata");
    expect(cardFaceImage(cardProduct(strata))).toBe("/wallet/citi-strata.jpg");
  });

  test("GBSL, Claudia GBSL, and Keller Services cards use Signify", () => {
    for (const slug of ["wf-gbsl-cc", "wf-gbsl-claudia-cc", "wf-keller-services-cc"]) {
      const item = { ...creditItem, slug, issuerParser: "wells_fargo" };
      expect(cardProduct(item)).toBe("wells-signify");
      expect(cardFaceImage(cardProduct(item))).toBe("/wallet/wf-signify.jpg");
    }
  });

  test("WF Personal Card uses the Rewards photo", () => {
    const personal = { ...creditItem, slug: "wf-personal-cc", issuerParser: "wells_fargo" };
    expect(cardProduct(personal)).toBe("wells-personal");
    expect(cardFaceImage(cardProduct(personal))).toBe("/wallet/wf-personal.jpg");
  });

  test("WF GBSL Business Line uses the Business Line photo", () => {
    const line = { ...creditItem, slug: "wf-gbsl-business-line", issuerParser: "wells_fargo" };
    expect(cardProduct(line)).toBe("wells-business-line");
    expect(cardFaceImage(cardProduct(line))).toBe("/wallet/wf-business-line.jpg");
  });
});

describe("WalletCard markup", () => {
  test("front shows last four and one entity — not PAN, CVV, or Edit rules", () => {
    const front = faceHtml(renderCard(creditItem, false), "front");
    expect(front).toContain("0005");
    expect(front).toContain("Personal");
    expect(front).toContain("/wallet/amex-blue.jpg");
    expect(front).toContain("text-right");
    expect(front).toContain("top-1/2");
    expect(front).toContain("backdrop-blur-md");
    expect(front).not.toContain("data-emv-chip");
    expect(front).not.toContain("3782 822463 10005");
    expect(front).not.toContain("1234");
    expect(front).not.toContain("Copy Card number");
    expect(front).not.toContain("Edit rules");
    expect(front).not.toContain("Hundie Untracked");
  });

  test("photo cards do not draw a second chip over the real one", () => {
    const acaa: WalletItem = {
      ...creditItem,
      id: "acct-acaa",
      slug: "cap-one-acaa-austin",
      displayName: "Cap One Austin ACAA",
      issuerParser: "capital_one",
    };
    const front = faceHtml(renderCard(acaa, false), "front");
    expect(front).toContain("/wallet/cap-one-spark-acaa.png");
    expect(front).not.toContain("data-emv-chip");
    expect(front).toContain("text-right");
    expect(front).toContain("top-1/2");
  });

  test("credit back shows masked number, expiration, and CVV plus Edit", () => {
    const back = faceHtml(renderCard(creditItem, true), "back");
    expect(back).toContain("•••• •••••• 0005");
    expect(back).toContain("••/••");
    expect(back).toContain("Show Card number");
    expect(back).toContain("Show Expiration");
    expect(back).toContain("Show CVV");
    expect(back).toContain("Edit");
    expect(back).not.toContain("3782 822463 10005");
    expect(back).not.toContain("Save entity");
    expect(back).not.toContain("Edit rules");
  });

  test("clicking unmasks card number, expiration, and CVV together", () => {
    const back = faceHtml(renderCard(creditItem, true, true, creditSecrets), "back");
    expect(back).toContain("3782 822463 10005");
    expect(back).toContain("09/27");
    expect(back).toContain("Hide CVV");
  });

  test("Edit dialog holds PAN, expiry, CVV, entity, and rules", () => {
    const html = renderEdit(creditItem, creditSecrets);
    expect(html).toContain("Edit Amex Alex Personal");
    expect(html).toContain("Card number");
    expect(html).toContain("Expiration");
    expect(html).toContain("CVV");
    expect(html).toContain("Edit rules");
  });

  test("wallet-only cards omit Edit rules", () => {
    const html = renderEdit(untrackedItem, creditSecrets);
    expect(html).not.toContain("Edit rules");
    expect(renderCard(untrackedItem, true)).toContain("wallet only");
  });

  test("bank fronts use a building mark instead of a chip", () => {
    const front = faceHtml(renderCard(bankItem, false), "front");
    expect(front).toContain("data-bank-mark");
    expect(front).not.toContain("data-emv-chip");
  });

  test("bank back shows masked routing and account, not CVV", () => {
    const back = faceHtml(renderCard(bankItem, true), "back");
    expect(back).toContain("•••• 2333");
    expect(back).toContain("Show Routing");
    expect(back).toContain("Show Account");
    expect(back).not.toContain("Show CVV");
    expect(back).not.toContain("000111222333");
    expect(back).toContain("Edit");
  });

  test("bank Edit dialog has routing and account, not CVV", () => {
    const html = renderEdit(bankItem, bankSecrets);
    expect(html).toContain("Routing");
    expect(html).toContain("Account number");
    expect(html).not.toContain("CVV");
  });

  test("added cards and accounts are always Untracked until linked in Connections", () => {
    const card = createAddedWalletItem(
      {
        kind: "card",
        displayName: "New Amex",
        secrets: creditSecrets,
      },
      "id-card",
    );
    const account = createAddedWalletItem(
      {
        kind: "checking",
        displayName: "New checking",
        secrets: bankSecrets,
      },
      "id-bank",
    );
    expect(card.ledgerAccount).toBe(false);
    expect(card.accountId).toBeNull();
    expect(card.defaultEntity).toBeNull();
    expect(card.initialChipId).toBe(HUNDIE_UNTRACKED_SLUG);
    expect(account.ledgerAccount).toBe(false);
    expect(account.accountId).toBeNull();
    expect(account.defaultEntity).toBeNull();
    expect(account.initialChipId).toBe(HUNDIE_UNTRACKED_SLUG);
  });
});
