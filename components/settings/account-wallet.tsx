"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import {
  entityChipOptions,
  nextUnmaskedCard,
  partitionWalletItems,
  unmaskedAfterOpeningCard,
  type EntityChip,
  type WalletItem,
} from "@/lib/settings/wallet-mock";
import { WalletAddDialog } from "@/components/settings/wallet-add-dialog";
import { WalletCard } from "@/components/settings/wallet-card";
import { Button } from "@/components/ui/button";

type AccountWalletProps = {
  items: WalletItem[];
  entities: EntityChip[];
};

type WalletGroupKey = "cards" | "accounts";

export function AccountWallet({ items, entities }: AccountWalletProps) {
  const router = useRouter();
  const chips = useMemo(() => entityChipOptions(entities), [entities]);
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [unmaskedCardId, setUnmaskedCardId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<WalletGroupKey, boolean>>({
    cards: true,
    accounts: true,
  });
  const { cards, accounts: bankAccounts } = useMemo(() => partitionWalletItems(items), [items]);

  function openCard(cardId: string) {
    setOpenCardId(cardId);
    setUnmaskedCardId((current) => unmaskedAfterOpeningCard(current, cardId));
  }

  function closeCard() {
    setOpenCardId(null);
    setUnmaskedCardId(null);
  }

  function toggleGroup(key: WalletGroupKey) {
    setOpenGroups((current) => ({ ...current, [key]: !current[key] }));
  }

  function renderGrid(groupItems: WalletItem[]) {
    return (
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
        {groupItems.map((item) => (
          <WalletCard
            key={item.id}
            item={item}
            entities={chips}
            classifiableEntities={entities}
            flipped={openCardId === item.id}
            onFlip={(open) => (open ? openCard(item.id) : closeCard())}
            secretsRevealed={unmaskedCardId === item.id}
            onToggleUnmask={() => setUnmaskedCardId((current) => nextUnmaskedCard(current, item.id))}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" />
          Add
        </Button>
      </div>

      <div className="space-y-10">
        {cards.length > 0 ? (
          <WalletGroup
            title="Cards"
            count={cards.length}
            open={openGroups.cards}
            onToggle={() => toggleGroup("cards")}
          >
            {renderGrid(cards)}
          </WalletGroup>
        ) : null}
        {bankAccounts.length > 0 ? (
          <WalletGroup
            title="Accounts"
            count={bankAccounts.length}
            open={openGroups.accounts}
            onToggle={() => toggleGroup("accounts")}
          >
            {renderGrid(bankAccounts)}
          </WalletGroup>
        ) : null}
      </div>

      <WalletAddDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdded={() => router.refresh()}
      />
    </div>
  );
}

function WalletGroup({
  title,
  count,
  open,
  onToggle,
  children,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="-ml-1 flex w-full items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-muted/40"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <span className="text-sm tabular-nums text-muted-foreground">{count}</span>
      </button>
      {open ? children : null}
    </section>
  );
}
