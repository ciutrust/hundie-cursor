import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const envPath = resolve(root, ".env.local");

function loadEnv() {
  if (!existsSync(envPath)) {
    console.error("Missing .env.local — copy from .env.local.example");
    process.exit(1);
  }

  const env = {};
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return env;
}

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  console.error(
    "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) in .env.local",
  );
  process.exit(1);
}

if (!env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    "Warning: SUPABASE_SERVICE_ROLE_KEY not set — using publishable key. After RLS lockdown, anon returns no rows.",
  );
}

const supabase = createClient(url, key);

const { data, error } = await supabase
  .from("entities")
  .select("name, slug, status, is_classifiable")
  .order("display_order");

if (error) {
  console.error("Supabase connection failed:", error.message);
  process.exit(1);
}

console.log(`Connected to ${url}`);
console.log(`Entities (${data.length}):`);
for (const row of data) {
  const tag = row.is_classifiable ? "classifiable" : row.status;
  console.log(`  - ${row.name} (${row.slug}) [${tag}]`);
}
