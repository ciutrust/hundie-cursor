/**
 * READ-ONLY diagnostic: which Plaid accounts on each bank_connection are still
 * UNRESOLVED — no plaid_account_links row AND no plaid_ignored_accounts row?
 *
 * An unresolved account makes run-sync hold the forward-only cursor and park the
 * connection at status='needs_mapping', so its transactions are dropped on every
 * sync while mapped siblings keep importing. An account marked "don't track"
 * (plaid_ignored_accounts) resolves that gate without ever being imported, so it
 * is reported separately and does NOT count as blocking.
 *
 * Touches nothing: Plaid /accounts/get is a read call and no DB write is issued.
 *
 *   node scripts/diagnose-plaid-mapping.mjs
 *   node scripts/diagnose-plaid-mapping.mjs --institution "Wells Fargo"
 */
import { readFileSync } from "node:fs";
import { createDecipheriv } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";

// --- env ---------------------------------------------------------------
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Mirrors lib/crypto/secret-box.ts: base64( iv[12] | tag[16] | ciphertext ), AES-256-GCM. */
function decryptSecret(payload) {
  const key = Buffer.from(process.env.PLAID_TOKEN_ENC_KEY, "base64");
  if (key.length !== 32) throw new Error("PLAID_TOKEN_ENC_KEY must decode to 32 bytes");
  const buf = Buffer.from(payload, "base64");
  if (buf.length < IV_BYTES + TAG_BYTES) throw new Error("invalid ciphertext: too short");
  const decipher = createDecipheriv("aes-256-gcm", key, buf.subarray(0, IV_BYTES));
  decipher.setAuthTag(buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  return Buffer.concat([
    decipher.update(buf.subarray(IV_BYTES + TAG_BYTES)),
    decipher.final(),
  ]).toString("utf8");
}

const argv = process.argv.slice(2);
const instFilter = argv.includes("--institution") ? argv[argv.indexOf("--institution") + 1] : null;

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const plaidEnv = ["production", "sandbox"].includes(process.env.PLAID_ENV)
  ? process.env.PLAID_ENV
  : "sandbox";
// Say so rather than quietly aiming production tokens at sandbox, where every call fails.
if (process.env.PLAID_ENV && process.env.PLAID_ENV !== plaidEnv) {
  console.log(`!! PLAID_ENV="${process.env.PLAID_ENV}" is not valid - falling back to sandbox\n`);
}
const plaid = new PlaidApi(
  new Configuration({
    basePath: PlaidEnvironments[plaidEnv],
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID,
        "PLAID-SECRET": process.env.PLAID_SECRET,
      },
    },
  }),
);

// --- load ---------------------------------------------------------------
let q = db
  .from("bank_connections")
  .select("id, institution, external_item_id, access_token_cipher, status, sync_cursor, sync_from_date, last_synced_at")
  .order("institution");
if (instFilter) q = q.eq("institution", instFilter);

const { data: connections, error: connErr } = await q;
if (connErr) throw connErr;

const { data: links, error: linkErr } = await db
  .from("plaid_account_links")
  .select("connection_id, plaid_account_id, plaid_name, plaid_mask, account_id, accounts(slug, display_name, is_active)");
if (linkErr) throw linkErr;

// Deliberately-not-tracked accounts. Loaded globally, exactly like run-sync does — a
// plaid_account_id is unique table-wide, so scoping by connection could only hide a decision.
const { data: ignoredRows, error: ignErr } = await db
  .from("plaid_ignored_accounts")
  .select("plaid_account_id, reason");
if (ignErr) throw ignErr;
const ignored = new Map(ignoredRows.map((r) => [r.plaid_account_id, r]));

const { data: accounts, error: acctErr } = await db
  .from("accounts")
  .select("id, slug, display_name, account_type, is_active")
  .order("slug");
if (acctErr) throw acctErr;

const linkedAccountIds = new Set(links.map((l) => l.account_id));

console.log(`Plaid env: ${plaidEnv}   connections: ${connections.length}\n`);

const unresolvedAll = [];
const failedConnections = [];
let ignoredSeen = 0;

for (const conn of connections) {
  const mine = links.filter((l) => l.connection_id === conn.id);
  const mapped = new Map(mine.map((l) => [l.plaid_account_id, l]));

  console.log("=".repeat(78));
  console.log(`${conn.institution}   [${conn.status}]`);
  console.log(`  connection ${conn.id}`);
  console.log(
    `  item ${conn.external_item_id}   sync_from ${conn.sync_from_date}   last_synced ${conn.last_synced_at ?? "never"}`,
  );
  console.log(`  cursor ${conn.sync_cursor ? "present" : "NULL"}   mapped links: ${mine.length}`);

  let live;
  try {
    const res = await plaid.accountsGet({ access_token: decryptSecret(conn.access_token_cipher) });
    live = res.data.accounts;
  } catch (e) {
    const d = e?.response?.data;
    const why = `${d?.error_code ?? ""} ${d?.error_message ?? e.message}`.trim();
    console.log(`  !! accountsGet failed: ${why}`);
    console.log("");
    // Record it: a connection we could not read has NOT been cleared, and the summary below must
    // never report an all-clear it did not actually verify.
    failedConnections.push({ institution: conn.institution, id: conn.id, why });
    continue;
  }

  console.log(`  Plaid reports ${live.length} account(s):`);
  for (const a of live) {
    const link = mapped.get(a.account_id);
    const ign = ignored.get(a.account_id);
    const label = `${a.name}${a.mask ? ` ...${a.mask}` : ""} (${a.type}/${a.subtype ?? "-"})`;
    if (link) {
      console.log(`    [MAPPED]   ${label}  ->  ${link.accounts?.slug ?? link.account_id}`);
      // A link plus an ignore row is contradictory: the link wins in run-sync (it routes the
      // transactions), so the ignore row is stale and should be cleared.
      if (ign) console.log(`               !! also has a stale plaid_ignored_accounts row - link wins`);
    } else if (ign) {
      // Resolved without ever importing: run-sync counts it as answered and advances the cursor.
      console.log(`    [NOT TRACKED] ${label}${ign.reason ? `  - ${ign.reason}` : ""}`);
      ignoredSeen += 1;
    } else {
      console.log(`    [UNRESOLVED] ${label}`);
      console.log(`               plaid_account_id: ${a.account_id}`);
      unresolvedAll.push({ institution: conn.institution, connectionId: conn.id, account: a });
    }
  }

  // A link whose Plaid account no longer comes back is dead weight (closed account).
  for (const l of mine) {
    if (!live.some((a) => a.account_id === l.plaid_account_id)) {
      console.log(`    [STALE LINK] ${l.plaid_name ?? l.plaid_account_id} - not returned by Plaid`);
    }
  }
  console.log("");
}

console.log("=".repeat(78));
if (ignoredSeen > 0) {
  console.log(`${ignoredSeen} account(s) marked NOT TRACKED - resolved, never imported, not blocking.`);
}
if (failedConnections.length > 0) {
  console.log(
    `${failedConnections.length} connection(s) could NOT be checked - this is NOT an all-clear:`,
  );
  for (const f of failedConnections) console.log(`  ${f.institution} (${f.id}): ${f.why}`);
  console.log("");
  process.exitCode = 1;
}
if (unresolvedAll.length === 0) {
  console.log(
    failedConnections.length > 0
      ? "No unresolved accounts among the connections that COULD be read."
      : "No unresolved Plaid accounts. Any needs_mapping status clears on the next sync.",
  );
} else {
  console.log(`${unresolvedAll.length} UNRESOLVED account(s) - these block cursor advance:\n`);
  for (const u of unresolvedAll) {
    const a = u.account;
    console.log(`  ${u.institution}: ${a.name}${a.mask ? ` ...${a.mask}` : ""}  [${a.type}/${a.subtype ?? "-"}]`);
    console.log(`    plaid_account_id ${a.account_id}   connection ${u.connectionId}`);
  }
  console.log(`\nLedger accounts with no Plaid link (candidate map targets):`);
  const free = accounts.filter((a) => !linkedAccountIds.has(a.id) && a.is_active);
  if (free.length === 0) console.log("  (none - every active account is already linked)");
  for (const a of free) console.log(`  ${a.slug}  "${a.display_name}"  ${a.account_type}`);
}
