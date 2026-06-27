import type { Metadata } from "next";
import { LegalLink, LegalShell, Section } from "@/components/legal/legal-shell";

export const metadata: Metadata = {
  title: "Privacy Policy — Hundie",
  description: "How Hundie collects, uses, and protects financial data.",
};

export default function PrivacyPolicyPage() {
  return (
    <LegalShell title="Privacy Policy" effective="June 2026">
      <Section title="Who we are">
        <p>
          Hundie is a private expense-management and bookkeeping application operated by the
          Ciunciusky Trust. It is used by the trust&apos;s owner and one bookkeeping partner to
          organize spending across the owner&apos;s own business and personal accounts. This policy
          explains what data Hundie collects, how it is used, and how it is protected. Questions can
          go to Alex Ciunciusky at{" "}
          <LegalLink href="mailto:alexbhp@gmail.com">alexbhp@gmail.com</LegalLink>.
        </p>
      </Section>

      <Section title="Information we collect">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong className="font-medium text-foreground">Account information.</strong> The email
            address used to sign in.
          </li>
          <li>
            <strong className="font-medium text-foreground">Financial data through Plaid.</strong>{" "}
            When an account is connected through Plaid, Hundie receives transaction history (date,
            amount, description, and merchant) and basic account details (name, last four digits,
            and type) for the accounts the owner chooses to link. Hundie also receives a Plaid access
            token that lets it pull new transactions. Hundie never receives or stores bank usernames
            or passwords; those stay with Plaid.
          </li>
          <li>
            <strong className="font-medium text-foreground">Settings.</strong> The entities,
            categories, and account mappings the owner configures.
          </li>
        </ul>
      </Section>

      <Section title="How we use it">
        <p>
          Financial data is used to categorize and organize spending by entity and expense category,
          to produce per-entity reports, and to sync that categorized data into the owner&apos;s
          accounting software (QuickBooks Online). It is also used to operate and secure the
          application. Hundie does not use this data for advertising and does not sell it.
        </p>
      </Section>

      <Section title="Plaid">
        <p>
          Hundie uses Plaid to connect to financial institutions and retrieve transaction data. By
          linking an account, you also agree to Plaid&apos;s handling of your data as described in
          the{" "}
          <LegalLink href="https://plaid.com/legal/#end-user-privacy-policy">
            Plaid End User Privacy Policy
          </LegalLink>
          . You can review or revoke the connections you have made through Plaid at{" "}
          <LegalLink href="https://my.plaid.com">my.plaid.com</LegalLink>.
        </p>
      </Section>

      <Section title="Who we share it with">
        <p>
          Financial data is shared only with the service providers needed to run the application:
          Plaid (bank connections), Supabase (database and authentication), Vercel (application
          hosting), and QuickBooks Online / Intuit (the accounting software the owner syncs to). It
          is not sold, rented, or shared with anyone outside these providers, and it is never used
          for advertising.
        </p>
      </Section>

      <Section title="How we protect it">
        <p>
          All traffic uses HTTPS with TLS 1.2 or higher. Stored data is encrypted at rest with
          AES-256, and Plaid access tokens are additionally encrypted by the application with
          AES-256-GCM using a key kept only in the server environment. Access to the systems that
          hold financial data is limited to authorized accounts protected by multi-factor
          authentication, and every data table is restricted to authenticated access at the database
          level.
        </p>
      </Section>

      <Section title="Retention and deletion">
        <p>
          Transaction data is kept while it is needed for bookkeeping and any applicable tax
          recordkeeping. You can remove a linked bank in the application at any time, which revokes
          the connection at Plaid and deletes the stored token and account mappings. You can also
          request deletion of your transaction data and settings by contacting us. More detail is in
          the trust&apos;s Data Retention and Disposal Policy.
        </p>
      </Section>

      <Section title="Your choices">
        <p>
          You can disconnect any linked account at any time, and you can ask to access, correct, or
          delete your data. Because the application is used by the owner and their bookkeeping
          partner for the owner&apos;s own finances, the owner controls what is connected and what is
          stored.
        </p>
      </Section>

      <Section title="Consent">
        <p>
          You connect your own accounts knowingly through Plaid&apos;s secure linking flow. That
          action is your consent to the collection and processing of the data described here for the
          purposes described here.
        </p>
      </Section>

      <Section title="Changes and contact">
        <p>
          If this policy changes, the effective date above will be updated. For any question about
          privacy or your data, contact Alex Ciunciusky at{" "}
          <LegalLink href="mailto:alexbhp@gmail.com">alexbhp@gmail.com</LegalLink>.
        </p>
      </Section>
    </LegalShell>
  );
}
