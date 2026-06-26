import { AccountSettingsEditor } from "@/components/settings/account-settings-editor";
import { getAccountsWithEntities } from "@/lib/queries/accounts";
import { getClassifiableEntities } from "@/lib/queries/review";

export default async function AccountSettingsPage() {
  const [accounts, entities] = await Promise.all([getAccountsWithEntities(), getClassifiableEntities()]);

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <p className="text-sm font-medium text-primary">Settings</p>
        <h1 className="text-3xl font-semibold tracking-tight">Accounts & entities</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Configure which entity new imports land in. Date rules switch entity assignment from a chosen date
          forward — like Capital One Quicksilver moving from GBSL to Personal in July. Existing classified
          transactions stay as-is until you reclassify them.
        </p>
      </div>

      <AccountSettingsEditor accounts={accounts} entities={entities} />
    </div>
  );
}
