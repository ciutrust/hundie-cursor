import Link from "next/link";
import { AccountWallet } from "@/components/settings/account-wallet";
import { getClassifiableEntities } from "@/lib/queries/review";
import { getWalletItems } from "@/lib/queries/wallet";

export default async function AccountSettingsPage() {
  const [items, entities] = await Promise.all([getWalletItems(), getClassifiableEntities()]);

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <p className="text-sm font-medium text-primary">Settings</p>
        <h1 className="text-3xl font-semibold tracking-tight">Accounts</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Front shows the last four digits and entity. Flip, then click a number to reveal card number, expiration, and
          CVV (or routing and account). Edit saves to the encrypted vault. Add a card or account as untracked (wallet
          only); link it under{" "}
          <Link href="/settings/connections" className="font-medium text-foreground underline-offset-4 hover:underline">
            Connections
          </Link>
          .
        </p>
      </div>

      <AccountWallet items={items} entities={entities} />
    </div>
  );
}
