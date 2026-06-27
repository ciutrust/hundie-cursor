import type { Metadata } from "next";
import { LegalLink, LegalShell, Section } from "@/components/legal/legal-shell";

export const metadata: Metadata = {
  title: "Data Retention and Disposal Policy — Hundie",
  description: "What Hundie keeps, for how long, and how it is disposed of.",
};

export default function DataRetentionPage() {
  return (
    <LegalShell title="Data Retention and Disposal Policy" effective="June 2026">
      <Section title="Purpose">
        <p>
          This policy describes what data the Hundie application keeps, how long it is kept, and how
          it is disposed of when it is no longer needed. It applies to the financial data Hundie
          receives through Plaid and the settings the owner configures. It is maintained by the
          Ciunciusky Trust.
        </p>
      </Section>

      <Section title="What we keep and for how long">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong className="font-medium text-foreground">Transaction records.</strong> Kept while
            they are needed for bookkeeping and any applicable tax recordkeeping. They are removed
            when they are no longer needed or when the owner requests deletion.
          </li>
          <li>
            <strong className="font-medium text-foreground">Plaid access tokens and account
            mappings.</strong> Kept only while a bank connection is active. They are deleted as soon
            as the connection is removed.
          </li>
          <li>
            <strong className="font-medium text-foreground">Account and sign-in information.</strong>{" "}
            Kept while the account is active, and removed when the account is closed.
          </li>
        </ul>
      </Section>

      <Section title="How we dispose of data">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            Removing a bank connection in the application revokes the connection at Plaid and deletes
            the stored access token and account mappings from the database.
          </li>
          <li>
            On request, or when an account is closed, the related transaction records and settings
            are deleted from the database.
          </li>
          <li>
            Access tokens are stored only as encrypted text. Once a token or its encryption key is
            removed, the stored value can no longer be used.
          </li>
          <li>
            The database is hosted on Supabase, which keeps short-term backups for recovery. Deleted
            data ages out of those backups on the provider&apos;s normal backup cycle.
          </li>
        </ul>
      </Section>

      <Section title="Review">
        <p>
          This policy is reviewed at least once a year and after any significant change to how the
          application stores or handles data.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          To request deletion of your data or to ask a question about retention, contact Alex
          Ciunciusky at{" "}
          <LegalLink href="mailto:alexbhp@gmail.com">alexbhp@gmail.com</LegalLink>. See also the{" "}
          <a href="/privacy" className="text-primary underline-offset-4 hover:underline">
            Privacy Policy
          </a>
          .
        </p>
      </Section>
    </LegalShell>
  );
}
