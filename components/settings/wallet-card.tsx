"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, Copy } from "lucide-react";
import type { AccountDateRule } from "@/lib/queries/accounts";
import { cn } from "@/lib/utils";
import { updateAccountSettings } from "@/lib/actions/accounts";
import { revealWalletSecrets, saveWalletSecrets } from "@/lib/actions/wallet";
import { emptySecretsForKind } from "@/lib/wallet/vault";
import {
  canPersistEntityId,
  cardFaceClass,
  cardFaceImage,
  cardProduct,
  chipLabel,
  clickShouldToggleReveal,
  displayLast4,
  emvChipTone,
  findEntity,
  formatMaskedAccountLast4,
  formatMaskedPanLast4,
  formatMaskedRoutingLast4,
  formatPan,
  isBankAccountType,
  lastFour,
  maskCvv,
  maskCvvForNetwork,
  maskExpiry,
  type EntityChip,
  type WalletItem,
  type WalletSecrets,
} from "@/lib/settings/wallet-mock";
import { BankBuildingMark, EmvChip, IssuerLogo } from "@/components/settings/wallet-brands";
import { WalletEditDialog } from "@/components/settings/wallet-edit-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type WalletCardProps = {
  item: WalletItem;
  entities: EntityChip[];
  classifiableEntities: EntityChip[];
  flipped?: boolean;
  onFlip?: (open: boolean) => void;
  secretsRevealed?: boolean;
  onToggleUnmask?: () => void;
  defaultFlipped?: boolean;
  defaultEditOpen?: boolean;
  secrets?: WalletSecrets;
};

export function WalletCard({
  item,
  entities,
  classifiableEntities,
  flipped: flippedProp,
  onFlip,
  secretsRevealed = false,
  onToggleUnmask,
  defaultFlipped = false,
  defaultEditOpen = false,
  secrets: secretsProp,
}: WalletCardProps) {
  const [internalFlipped, setInternalFlipped] = useState(defaultFlipped);
  const flipped = flippedProp ?? internalFlipped;
  const [savedEntityId, setSavedEntityId] = useState(item.initialChipId);
  const [draftEntityId, setDraftEntityId] = useState(item.initialChipId);
  const [displayName, setDisplayName] = useState(item.displayName);
  const [last4, setLast4] = useState(item.last4);
  const [expiry, setExpiry] = useState(item.expiry);
  const [cachedSecrets, setCachedSecrets] = useState<WalletSecrets | null>(secretsProp ?? null);
  const [dateRules, setDateRules] = useState<AccountDateRule[]>(item.dateRules);
  const [editOpen, setEditOpen] = useState(defaultEditOpen);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const product = cardProduct(item);
  const faceImage = cardFaceImage(product);
  const savedEntity = findEntity(entities, savedEntityId);
  const draftEntity = findEntity(entities, draftEntityId);
  const isBank = isBankAccountType(item.accountType);
  const network = cachedSecrets?.kind === "card" ? cachedSecrets.network : item.network;
  const currentSecrets =
    cachedSecrets ?? emptySecretsForKind(isBank ? "bank" : "card", { expiry, network: item.network });

  useEffect(() => {
    if (!flipped) setCachedSecrets(secretsProp ?? null);
  }, [flipped, secretsProp]);

  function flipToBack() {
    onFlip?.(true);
    if (flippedProp === undefined) setInternalFlipped(true);
  }

  function flipToFront() {
    onFlip?.(false);
    if (flippedProp === undefined) setInternalFlipped(false);
  }

  function maybeFlipToFront(target: EventTarget | null) {
    if (clickShouldToggleReveal(target)) flipToFront();
  }

  async function loadSecrets(): Promise<WalletSecrets | null> {
    if (cachedSecrets) return cachedSecrets;
    if (secretsProp) {
      setCachedSecrets(secretsProp);
      return secretsProp;
    }
    const result = await revealWalletSecrets(item.id);
    if ("error" in result && result.error) {
      setSaveError(result.error);
      return null;
    }
    if (!("secrets" in result) || !result.secrets) return null;
    setCachedSecrets(result.secrets);
    return result.secrets;
  }

  function persist(entityId: string, rules: AccountDateRule[]) {
    setSaveError(null);
    startTransition(async () => {
      if (item.ledgerAccount && item.accountId && canPersistEntityId(entityId, classifiableEntities)) {
        const result = await updateAccountSettings({
          accountId: item.accountId,
          defaultEntityId: entityId,
          dateRules: rules,
        });
        if (result.error) {
          setSaveError(result.error);
          return;
        }
      }
      setSavedEntityId(entityId);
      setDraftEntityId(entityId);
      setDateRules(rules);
      setConfirmOpen(false);
      setEditOpen(false);
    });
  }

  function handleEditSave(next: {
    entityId: string;
    displayName: string;
    secrets: WalletSecrets;
    dateRules: AccountDateRule[];
  }) {
    setSaveError(null);
    startTransition(async () => {
      const saved = await saveWalletSecrets({
        walletItemId: item.id,
        displayName: next.displayName,
        secrets: next.secrets,
      });
      if ("error" in saved && saved.error) {
        setSaveError(saved.error);
        return;
      }
      setCachedSecrets(next.secrets);
      setDisplayName(next.displayName.trim() || displayName);
      if (saved.success) {
        setLast4(saved.last4);
        setExpiry(saved.expiry);
      }
      setDraftEntityId(next.entityId);
      setDateRules(next.dateRules);
      if (next.entityId !== savedEntityId) {
        setConfirmOpen(true);
        return;
      }
      persist(next.entityId, next.dateRules);
    });
  }

  function handleUnmask() {
    startTransition(async () => {
      const secrets = await loadSecrets();
      if (!secrets) return;
      onToggleUnmask?.();
    });
  }

  function handleEditOpen() {
    startTransition(async () => {
      const secrets = await loadSecrets();
      if (!secrets) return;
      setEditOpen(true);
    });
  }

  return (
    <div className="[perspective:1400px]">
      <div
        className={cn(
          "relative aspect-[1.586/1] w-full [transform-style:preserve-3d] transition-transform duration-500 ease-out",
          flipped && "[transform:rotateY(180deg)]",
        )}
      >
        <button
          type="button"
          tabIndex={flipped ? -1 : 0}
          aria-hidden={flipped}
          aria-label={`Show back of ${displayName}`}
          data-face="front"
          onClick={flipToBack}
          className={cn(
            "absolute inset-0 overflow-hidden rounded-[1.35rem] p-5 text-left",
            "shadow-[0_18px_40px_-18px_rgba(0,0,0,0.65)] [backface-visibility:hidden]",
            "border-0 appearance-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80",
            flipped ? "z-0 pointer-events-none" : "z-10",
            cardFaceClass(product),
          )}
        >
          {faceImage ? (
            <img
              src={faceImage}
              alt=""
              aria-hidden
              className="pointer-events-none absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <>
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/18 via-transparent to-black/25" />
              <IssuerLogo
                issuer={item.issuerParser}
                className={cn(
                  "absolute right-5 top-4 h-8 w-auto max-w-[9rem]",
                  item.issuerParser === "wells_fargo" ? "text-[#FFCD41]" : "text-white",
                )}
              />
              {isBank ? (
                <BankBuildingMark className="absolute left-5 top-1/2 h-10 w-10 -translate-y-1/2 text-white" />
              ) : (
                <EmvChip
                  tone={emvChipTone(product)}
                  chipId={item.id}
                  className="absolute left-5 top-[42%] h-[2.35rem] w-auto -translate-y-1/2"
                />
              )}
            </>
          )}

          <span className="absolute left-4 top-4 rounded-full bg-black/40 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-[2px]">
            {savedEntity ? chipLabel(savedEntity) : "Not tracked"}
          </span>
          <p
            data-last4
            className={cn(
              "absolute top-1/2 right-5 z-10 -translate-y-1/2 rounded-md px-2.5 py-1.5",
              "bg-black/45 text-right font-mono text-2xl font-semibold tracking-[0.28em] text-white",
              "shadow-[0_8px_24px_-12px_rgba(0,0,0,0.8)] ring-1 ring-inset ring-white/20 backdrop-blur-md",
            )}
          >
            {displayLast4(last4)}
          </p>
        </button>

        <div
          data-face="back"
          className={cn(
            "absolute inset-0 flex flex-col overflow-hidden rounded-[1.35rem] p-3",
            "shadow-[0_18px_40px_-18px_rgba(0,0,0,0.65)] [backface-visibility:hidden] [transform:rotateY(180deg)]",
            flipped ? "z-10" : "z-0 pointer-events-none",
            cardFaceClass(product),
          )}
          onClick={(event) => maybeFlipToFront(event.target)}
        >
          <div className="mb-2 h-5 shrink-0 rounded-sm bg-black/55" aria-hidden />
          <div className="flex items-start justify-between gap-2">
            <p className="truncate text-sm font-semibold">
              {displayName}
              {!item.ledgerAccount ? " · wallet only" : ""}
            </p>
            <button
              type="button"
              className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide hover:bg-white/25"
              onClick={flipToFront}
            >
              Flip
            </button>
          </div>
          <div className="mt-2 flex min-h-0 flex-col" data-no-flip>
            <div className="space-y-1.5">
              {currentSecrets.kind === "card" ? (
                <>
                  <CopyLine
                    label="Card number"
                    value={formatPan(currentSecrets.pan, currentSecrets.network)}
                    masked={formatMaskedPanLast4(last4, network ?? "visa")}
                    revealed={secretsRevealed}
                    onToggleReveal={handleUnmask}
                  />
                  <div className="grid grid-cols-2 gap-1.5">
                    <CopyLine
                      label="Expiration"
                      value={currentSecrets.expiry || expiry || ""}
                      masked={maskExpiry()}
                      revealed={secretsRevealed}
                      onToggleReveal={handleUnmask}
                    />
                    <CopyLine
                      label="CVV"
                      value={currentSecrets.cvv}
                      masked={currentSecrets.cvv ? maskCvv(currentSecrets.cvv) : maskCvvForNetwork(network)}
                      revealed={secretsRevealed}
                      onToggleReveal={handleUnmask}
                    />
                  </div>
                </>
              ) : (
                <div className="grid grid-cols-2 gap-1.5">
                  <CopyLine
                    label="Routing"
                    value={currentSecrets.routing}
                    masked={
                      currentSecrets.routing
                        ? formatMaskedRoutingLast4(lastFour(currentSecrets.routing))
                        : "•••••••••"
                    }
                    revealed={secretsRevealed}
                    onToggleReveal={handleUnmask}
                  />
                  <CopyLine
                    label="Account"
                    value={currentSecrets.accountNumber}
                    masked={formatMaskedAccountLast4(last4)}
                    revealed={secretsRevealed}
                    onToggleReveal={handleUnmask}
                  />
                </div>
              )}
            </div>
            <div className="mt-4 flex justify-end">
              <EditButton onClick={handleEditOpen} />
            </div>
          </div>
        </div>
      </div>

      {editOpen ? (
        <WalletEditDialog
          key={`${item.id}-edit`}
          open={editOpen}
          onOpenChange={setEditOpen}
          item={{ ...item, displayName }}
          secrets={currentSecrets}
          entities={entities}
          classifiableEntities={classifiableEntities}
          savedEntityId={savedEntityId}
          dateRules={dateRules}
          onSave={handleEditSave}
          isPending={isPending}
          saveError={saveError}
        />
      ) : null}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Make sure you want to make this switch</DialogTitle>
            <DialogDescription>
              {displayName} will move from {savedEntity ? chipLabel(savedEntity) : "Not tracked"} to{" "}
              {draftEntity ? chipLabel(draftEntity) : "Not tracked"}. Existing classified transactions stay as-is until
              you reclassify them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button onClick={() => persist(draftEntityId, dateRules)} disabled={isPending}>
              {isPending ? "Saving…" : "Switch entity"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EditButton({ onClick }: { onClick: () => void }) {
  return (
    <Button size="sm" className="h-7 bg-white px-3 text-zinc-900 hover:bg-white/90" onClick={onClick}>
      Edit
    </Button>
  );
}

function CopyLine({
  label,
  value,
  masked,
  revealed,
  onToggleReveal,
}: {
  label: string;
  value: string;
  masked: string;
  revealed: boolean;
  onToggleReveal: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const shown = revealed ? value : masked;

  async function copy() {
    try {
      if (!revealed) onToggleReveal();
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex items-start gap-1.5 rounded-md bg-black/25 px-2 py-1">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wide text-white/60">{label}</p>
        <button
          type="button"
          aria-pressed={revealed}
          aria-label={revealed ? `Hide ${label}` : `Show ${label}`}
          onClick={onToggleReveal}
          className="w-full truncate rounded-sm text-left font-mono text-sm tracking-wide hover:text-white"
        >
          {shown}
        </button>
      </div>
      <button
        type="button"
        aria-label={`Copy ${label}`}
        onClick={copy}
        className="mt-0.5 shrink-0 rounded-md p-1 text-white/80 hover:bg-white/10 hover:text-white"
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}
