import {
  Configuration,
  CountryCode,
  PlaidApi,
  PlaidEnvironments,
  Products,
  type Transaction as PlaidTransaction,
} from "plaid";
import { mapAccountType, mapTransaction } from "./plaid-map";
import { collectSync } from "./plaid-sync";
import type {
  Aggregator,
  AggregatorAccount,
  AggregatorLiability,
  AggregatorResult,
  AggregatorSyncResult,
} from "./types";

/**
 * Plaid adapter. Reached through the official `plaid` Node SDK (auth = client_id + secret
 * headers). Flow: linkToken() → open Plaid Link in the browser → exchange(public_token)
 * → access_token → listAccounts() / syncTransactions().
 *
 * Env: PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV (sandbox | production). The secret must match
 * the environment (sandbox secret for sandbox).
 */

function plaidEnv(): keyof typeof PlaidEnvironments {
  const env = process.env.PLAID_ENV;
  if (env === "production" || env === "sandbox") return env;
  return "sandbox";
}

function client(): PlaidApi | null {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  if (!clientId || !secret) return null;
  return new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments[plaidEnv()],
      baseOptions: {
        headers: { "PLAID-CLIENT-ID": clientId, "PLAID-SECRET": secret },
      },
    }),
  );
}

/** Extract the useful message out of a Plaid/axios error. */
function errMsg(e: unknown): string {
  const ax = e as {
    response?: { data?: { error_code?: string; error_message?: string } };
    message?: string;
  };
  const data = ax?.response?.data;
  if (data?.error_message) {
    return `${data.error_code ?? "plaid_error"}: ${data.error_message}`;
  }
  return ax?.message ?? "unknown Plaid error";
}

/** Amount owed. Plaid reports credit and mortgage current balances as positive. */
function owed(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(Math.abs(value) * 100) / 100;
}

/** APR percent, capped to the liabilities.interest_rate numeric(5,3) column. */
function finiteApr(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value < 0 || value >= 100) return null;
  return Math.round(value * 1000) / 1000;
}

const NOT_CONFIGURED: AggregatorResult<never> = {
  ok: false,
  error: "PLAID_CLIENT_ID / PLAID_SECRET not set",
  notConfigured: true,
};

export class PlaidAggregator implements Aggregator {
  readonly name = "plaid";

  isConfigured(): boolean {
    return Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
  }

  async linkToken(userId: string): Promise<AggregatorResult<string>> {
    const plaid = client();
    if (!plaid) return NOT_CONFIGURED;
    try {
      const res = await plaid.linkTokenCreate({
        user: { client_user_id: userId },
        client_name: "Hundie",
        products: [Products.Transactions],
        // Consent to liabilities when the institution supports it. Checking-only banks still link.
        required_if_supported_products: [Products.Liabilities],
        country_codes: [CountryCode.Us],
        language: "en",
      });
      return { ok: true, data: res.data.link_token };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  }

  async linkTokenForUpdate(accessToken: string): Promise<AggregatorResult<string>> {
    const plaid = client();
    if (!plaid) return NOT_CONFIGURED;
    try {
      // Update mode: pass the existing access_token and OMIT products — re-auths the same item.
      const res = await plaid.linkTokenCreate({
        user: { client_user_id: "hundie-operator" },
        client_name: "Hundie",
        country_codes: [CountryCode.Us],
        language: "en",
        access_token: accessToken,
      });
      return { ok: true, data: res.data.link_token };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  }

  async linkTokenForLiabilities(accessToken: string): Promise<AggregatorResult<string>> {
    const plaid = client();
    if (!plaid) return NOT_CONFIGURED;
    try {
      // Update mode for ONE new product. Do not repeat Transactions or Link will refuse the token.
      const res = await plaid.linkTokenCreate({
        user: { client_user_id: "hundie-operator" },
        client_name: "Hundie",
        country_codes: [CountryCode.Us],
        language: "en",
        access_token: accessToken,
        products: [Products.Liabilities],
      });
      return { ok: true, data: res.data.link_token };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  }

  async removeItem(accessToken: string): Promise<AggregatorResult<void>> {
    const plaid = client();
    if (!plaid) return NOT_CONFIGURED;
    try {
      await plaid.itemRemove({ access_token: accessToken });
      return { ok: true, data: undefined };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  }

  async exchange(
    publicToken: string,
  ): Promise<AggregatorResult<{ accessToken: string; itemId: string }>> {
    const plaid = client();
    if (!plaid) return NOT_CONFIGURED;
    try {
      const res = await plaid.itemPublicTokenExchange({ public_token: publicToken });
      return {
        ok: true,
        data: { accessToken: res.data.access_token, itemId: res.data.item_id },
      };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  }

  async listAccounts(accessToken: string): Promise<AggregatorResult<AggregatorAccount[]>> {
    const plaid = client();
    if (!plaid) return NOT_CONFIGURED;
    try {
      const res = await plaid.accountsGet({ access_token: accessToken });
      const institution = await this.institutionName(
        plaid,
        res.data.item.institution_id ?? null,
      );
      const accounts: AggregatorAccount[] = res.data.accounts.map((a) => ({
        externalId: a.account_id,
        name: a.name,
        last4: a.mask ?? null,
        type: mapAccountType(a.type),
        institution,
      }));
      return { ok: true, data: accounts };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  }

  /**
   * Incremental sync via Plaid's cursor-based /transactions/sync. Pass the saved cursor
   * (null/undefined = full initial sync); returns added/modified/removed plus the new cursor.
   */
  async syncTransactions(
    accessToken: string,
    cursor?: string | null,
  ): Promise<AggregatorResult<AggregatorSyncResult>> {
    const plaid = client();
    if (!plaid) return NOT_CONFIGURED;
    try {
      const collected = await collectSync<PlaidTransaction>(
        async (cur) => {
          const res = await plaid.transactionsSync({
            access_token: accessToken,
            cursor: cur,
            count: 500,
          });
          return {
            added: res.data.added,
            modified: res.data.modified,
            removed: res.data.removed.map((r) => r.transaction_id ?? "").filter(Boolean),
            hasMore: res.data.has_more,
            nextCursor: res.data.next_cursor,
          };
        },
        cursor ?? undefined,
        { onRestart: () => new Promise((r) => setTimeout(r, 1000)) },
      );
      return {
        ok: true,
        data: {
          added: collected.added.map(mapTransaction),
          modified: collected.modified.map(mapTransaction),
          removedExternalIds: collected.removed,
          cursor: collected.cursor ?? null,
        },
      };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  }

  async getLiabilities(accessToken: string): Promise<AggregatorResult<AggregatorLiability[]>> {
    const plaid = client();
    if (!plaid) return NOT_CONFIGURED;
    try {
      const res = await plaid.liabilitiesGet({ access_token: accessToken });
      const institution = await this.institutionName(
        plaid,
        res.data.item.institution_id ?? null,
      );
      const byId = new Map(res.data.accounts.map((account) => [account.account_id, account]));
      const out: AggregatorLiability[] = [];

      for (const mortgage of res.data.liabilities.mortgage ?? []) {
        if (!mortgage.account_id) continue;
        const account = byId.get(mortgage.account_id);
        out.push({
          accountId: mortgage.account_id,
          name: account?.name ?? "Mortgage",
          mask: account?.mask ?? null,
          institution,
          kind: "mortgage",
          balance: owed(account?.balances.current),
          apr: finiteApr(mortgage.interest_rate?.percentage),
        });
      }

      for (const credit of res.data.liabilities.credit ?? []) {
        if (!credit.account_id) continue;
        const account = byId.get(credit.account_id);
        const purchase =
          credit.aprs?.find((apr) => apr.apr_type === "purchase_apr") ?? credit.aprs?.[0];
        out.push({
          accountId: credit.account_id,
          name: account?.name ?? "Credit",
          mask: account?.mask ?? null,
          institution,
          kind: "credit",
          balance: owed(account?.balances.current),
          apr: finiteApr(purchase?.apr_percentage),
        });
      }

      for (const student of res.data.liabilities.student ?? []) {
        if (!student.account_id) continue;
        const account = byId.get(student.account_id);
        out.push({
          accountId: student.account_id,
          name: account?.name ?? "Student loan",
          mask: account?.mask ?? null,
          institution,
          kind: "student",
          balance: owed(account?.balances.current),
          apr: null,
        });
      }

      return { ok: true, data: out };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  }

  verifyWebhook(): boolean {
    // Plaid signs webhooks with a JWT in the Plaid-Verification header. Implemented in the
    // later webhook phase; the Sync-now button polls /sync directly and needs no webhook.
    return false;
  }

  private async institutionName(
    plaid: PlaidApi,
    institutionId: string | null,
  ): Promise<string> {
    if (!institutionId) return "Unknown";
    try {
      const res = await plaid.institutionsGetById({
        institution_id: institutionId,
        country_codes: [CountryCode.Us],
      });
      return res.data.institution.name;
    } catch {
      return institutionId;
    }
  }
}
