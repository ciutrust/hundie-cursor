import { ShieldCheck } from "lucide-react";
import { MfaSetup } from "./mfa-setup";

export default function SecurityPage() {
  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Setup · Security
        </p>
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h1 className="text-3xl font-semibold tracking-tight">Security</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Protect access to the ledger with two-factor authentication.
        </p>
      </div>

      <MfaSetup />
    </div>
  );
}
