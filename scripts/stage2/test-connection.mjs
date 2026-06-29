// Stage 2: read-only connection test for the DATABASE_URL pg path. Prints nothing secret.
import pg from "pg";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
function loadDotEnv() {
  const p = join(root, ".env.local");
  if (!existsSync(p)) return {};
  const env = {};
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[t.slice(0, eq)] = v;
  }
  return env;
}

const conn = process.env.DATABASE_URL || loadDotEnv().DATABASE_URL;
if (!conn) { console.error("DATABASE_URL not found in env or .env.local"); process.exit(2); }

// Mask: show only host:port, never user/password.
let masked = "(unparseable)";
try { const u = new URL(conn); masked = `${u.hostname}:${u.port || "5432"}${u.pathname}`; } catch {}
console.log(`Connecting to: ${masked}`);

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
const t0 = Date.now();
try {
  await client.connect();
  const { rows: [meta] } = await client.query(
    "select current_database() db, current_user usr, inet_server_addr() host, current_setting('server_version') ver"
  );
  const { rows: [c] } = await client.query(
    "select (select count(*) from entities) entities, (select count(*) from transactions) transactions, (select count(*) from qb_training_expenses) qbt"
  );
  console.log(`✅ Connected in ${Date.now() - t0}ms`);
  console.log(`   database=${meta.db}  user=${meta.usr}  pg=${meta.ver}`);
  console.log(`   sanity counts → entities=${c.entities} (expect 10), transactions=${c.transactions} (expect 6590), qb_training_expenses=${c.qbt} (expect 7012 post-snapshot)`);
  const ok = String(c.entities) === "10" && String(c.transactions) === "6590";
  console.log(ok ? "   ✓ matches the live Hundie DB the MCP sees." : "   ⚠ counts differ from expected — confirm this is the right project before applying.");
} catch (e) {
  console.error(`❌ Connection failed: ${e.message}`);
  if (/password|auth/i.test(e.message)) console.error("   → check the password in the URI.");
  if (/ENOTFOUND|EAI_AGAIN|timeout|ETIMEDOUT/i.test(e.message)) console.error("   → check the host/port (try the port-5432 pooler/direct URI).");
  process.exit(1);
} finally {
  await client.end();
}
