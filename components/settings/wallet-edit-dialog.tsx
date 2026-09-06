"use client";

import { useState } from "react";
import type { AccountDateRule } from "@/lib/queries/accounts";
import {
  canPersistEntityId,
  chipLabel,
  digitsOnly,
  formatExpiryInput,
  formatPanInput,
  inferCardNetwork,
  type EntityChip,
  type WalletItem,
  type WalletSecrets,
} from "@/lib/settings/wallet-mock";
import { AccountDateRulesEditor } from "@/components/settings/account-date-rules-editor";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type WalletEditDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: WalletItem;
  secrets: WalletSecrets;
  entities: EntityChip[];
  classifiableEntities: EntityChip[];
  savedEntityId: string;
  dateRules: AccountDateRule[];
  onSave: (next: { entityId: string; displayName: string; secrets: WalletSecrets; dateRules: AccountDateRule[] }) => void;
  isPending?: boolean;
  saveError?: string | null;
};

export function WalletEditDialog({
  open,
  onOpenChange,
  ...panel
}: WalletEditDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <WalletEditPanel {...panel} onCancel={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

export function WalletEditPanel({
  item,
  secrets,
  entities,
  classifiableEntities,
  savedEntityId,
  dateRules,
  onSave,
  isPending = false,
  saveError = null,
  onCancel,
}: Omit<WalletEditDialogProps, "open" | "onOpenChange"> & { onCancel?: () => void }) {
  const [entityId, setEntityId] = useState(savedEntityId);
  const [name, setName] = useState(item.displayName);
  const [draftSecrets, setDraftSecrets] = useState(secrets);
  const [draftRules, setDraftRules] = useState(dateRules);

  function submit() {
    onSave({ entityId, displayName: name, secrets: draftSecrets, dateRules: draftRules });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit {item.displayName}</DialogTitle>
        <DialogDescription>
          Change the name, entity, card or account numbers, and date rules. Numbers are encrypted in the vault.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <label className="block space-y-1.5 text-sm font-medium">
          Name
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </label>

        <label className="block space-y-1.5 text-sm font-medium">
          Entity
          <select
            value={entityId}
            onChange={(event) => setEntityId(event.target.value)}
            className="h-10 w-full rounded-md border border-border bg-card px-3 text-sm font-normal"
          >
            {entities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {chipLabel(entity)}
              </option>
            ))}
          </select>
        </label>

        {draftSecrets.kind === "card" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              className="sm:col-span-2"
              label="Card number"
              value={draftSecrets.pan}
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="cc-number"
              onChange={(pan) => {
                const formatted = formatPanInput(pan);
                setDraftSecrets({
                  ...draftSecrets,
                  pan: formatted,
                  network: inferCardNetwork(formatted),
                });
              }}
            />
            <Field
              label="Expiration"
              value={draftSecrets.expiry}
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="cc-exp"
              maxLength={5}
              placeholder="12/28"
              onChange={(expiry) => setDraftSecrets({ ...draftSecrets, expiry: formatExpiryInput(expiry) })}
            />
            <Field
              label="CVV"
              value={draftSecrets.cvv}
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="cc-csc"
              maxLength={4}
              onChange={(cvv) => setDraftSecrets({ ...draftSecrets, cvv: digitsOnly(cvv, 4) })}
            />
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Routing"
              value={draftSecrets.routing}
              onChange={(routing) => setDraftSecrets({ ...draftSecrets, routing })}
            />
            <Field
              label="Account number"
              value={draftSecrets.accountNumber}
              onChange={(accountNumber) => setDraftSecrets({ ...draftSecrets, accountNumber })}
            />
            <label className="block space-y-1.5 text-sm font-medium sm:col-span-2">
              Bank info
              <textarea
                value={draftSecrets.notes}
                onChange={(event) => setDraftSecrets({ ...draftSecrets, notes: event.target.value })}
                rows={3}
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
              />
            </label>
          </div>
        )}

        {item.ledgerAccount ? (
          <AccountDateRulesEditor
            accountId={item.accountId ?? item.id}
            accountName={item.displayName}
            defaultEntityId={
              canPersistEntityId(entityId, classifiableEntities) ? entityId : (item.defaultEntity?.id ?? "")
            }
            defaultEntityName={entities.find((entity) => entity.id === entityId)?.name ?? null}
            initialRules={draftRules}
            entities={classifiableEntities}
            hideSave
            onRulesChange={setDraftRules}
          />
        ) : null}

        {saveError ? <p className="text-sm text-destructive">{saveError}</p> : null}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={() => onCancel?.()} disabled={isPending}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={isPending}>
          {isPending ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </>
  );
}

function Field({
  label,
  value,
  onChange,
  className,
  inputMode,
  pattern,
  autoComplete,
  maxLength,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  inputMode?: "numeric";
  pattern?: string;
  autoComplete?: string;
  maxLength?: number;
  placeholder?: string;
}) {
  return (
    <label className={className ? `${className} block space-y-1.5 text-sm font-medium` : "block space-y-1.5 text-sm font-medium"}>
      {label}
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode={inputMode}
        pattern={pattern}
        autoComplete={autoComplete}
        maxLength={maxLength}
        placeholder={placeholder}
      />
    </label>
  );
}
