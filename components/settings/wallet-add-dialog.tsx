"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { createUntrackedWalletItem } from "@/lib/actions/wallet";
import { digitsOnly, formatExpiryInput, formatPanInput, inferCardNetwork, type WalletSecrets } from "@/lib/settings/wallet-mock";
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

type AddKind = "card" | "bank";

type WalletAddDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
};

export function WalletAddDialog({ open, onOpenChange, onAdded }: WalletAddDialogProps) {
  const [kind, setKind] = useState<AddKind | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [pan, setPan] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");
  const [routing, setRouting] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountType, setAccountType] = useState<"checking" | "savings">("checking");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function reset() {
    setKind(null);
    setDisplayName("");
    setPan("");
    setExpiry("");
    setCvv("");
    setRouting("");
    setAccountNumber("");
    setAccountType("checking");
    setError(null);
  }

  function submit() {
    if (!kind) return;
    const name = displayName.trim();
    if (!name) {
      setError("Name is required.");
      return;
    }
    const secrets: WalletSecrets =
      kind === "card"
        ? {
            kind: "card",
            pan: pan.replace(/\D/g, ""),
            expiry,
            cvv: cvv.trim(),
            network: inferCardNetwork(pan),
          }
        : {
            kind: "bank",
            routing: routing.replace(/\D/g, ""),
            accountNumber: accountNumber.replace(/\D/g, ""),
            notes: "",
          };
    setError(null);
    startTransition(async () => {
      const result = await createUntrackedWalletItem({
        kind: kind === "card" ? "card" : accountType,
        displayName: name,
        secrets,
      });
      if ("error" in result && result.error) {
        setError(result.error);
        return;
      }
      reset();
      onOpenChange(false);
      onAdded();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add card or account</DialogTitle>
          <DialogDescription>
            New cards and accounts are always untracked (wallet only). Link them later under{" "}
            <Link href="/settings/connections" className="font-medium text-foreground underline-offset-4 hover:underline">
              Connections
            </Link>
            . Numbers are stored in the encrypted vault, not the ledger.
          </DialogDescription>
        </DialogHeader>

        {kind == null ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setKind("card")}
              className="rounded-xl border border-border bg-card px-4 py-5 text-left hover:bg-accent"
            >
              <p className="font-semibold">Add card</p>
              <p className="mt-1 text-sm text-muted-foreground">Untracked. Keep a number in the wallet without books.</p>
            </button>
            <button
              type="button"
              onClick={() => setKind("bank")}
              className="rounded-xl border border-border bg-card px-4 py-5 text-left hover:bg-accent"
            >
              <p className="font-semibold">Add account</p>
              <p className="mt-1 text-sm text-muted-foreground">Untracked checking or savings.</p>
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <button type="button" className="text-sm text-muted-foreground hover:text-foreground" onClick={() => setKind(null)}>
              ← Card or account
            </button>
            <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              This {kind === "card" ? "card" : "account"} will be Hundie Untracked until you link it in Connections.
            </p>
            <label className="block space-y-1.5 text-sm font-medium">
              Name
              <Input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder={kind === "card" ? "Amex Gold" : "WF GBSL Checking"}
              />
            </label>
            {kind === "bank" ? (
              <label className="block space-y-1.5 text-sm font-medium">
                Type
                <select
                  value={accountType}
                  onChange={(event) => setAccountType(event.target.value as "checking" | "savings")}
                  className="h-10 w-full rounded-md border border-border bg-card px-3 text-sm font-normal"
                >
                  <option value="checking">Checking</option>
                  <option value="savings">Savings</option>
                </select>
              </label>
            ) : null}
            {kind === "card" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1.5 text-sm font-medium sm:col-span-2">
                  Card number
                  <Input
                    value={pan}
                    onChange={(event) => setPan(formatPanInput(event.target.value))}
                    placeholder="•••• •••• •••• 4242"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="cc-number"
                  />
                </label>
                <label className="block space-y-1.5 text-sm font-medium">
                  Expiration
                  <Input
                    value={expiry}
                    onChange={(event) => setExpiry(formatExpiryInput(event.target.value))}
                    placeholder="12/28"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="cc-exp"
                    maxLength={5}
                  />
                </label>
                <label className="block space-y-1.5 text-sm font-medium">
                  CVV
                  <Input
                    value={cvv}
                    onChange={(event) => setCvv(digitsOnly(event.target.value, 4))}
                    placeholder="123"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="cc-csc"
                    maxLength={4}
                  />
                </label>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1.5 text-sm font-medium">
                  Routing
                  <Input value={routing} onChange={(event) => setRouting(event.target.value)} />
                </label>
                <label className="block space-y-1.5 text-sm font-medium">
                  Account number
                  <Input value={accountNumber} onChange={(event) => setAccountNumber(event.target.value)} />
                </label>
              </div>
            )}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
        )}

        {kind ? (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={isPending}>
              {isPending ? "Saving…" : `Add ${kind === "card" ? "card" : "account"}`}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
