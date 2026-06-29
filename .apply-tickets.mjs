import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv(path) {
  const env = {};
  if (!existsSync(path)) return env;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[t.slice(0, i).trim()] = v;
  }
  return env;
}
const env = loadEnv(resolve(process.cwd(), ".env.local"));
const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY,
);
const usd = (n) => "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const map = JSON.parse(readFileSync("/private/tmp/claude-501/-Users-ac/3d1a7599-e7d2-4f73-888f-57b1fdce1665/scratchpad/big-tickets.json", "utf8"));
const { data: ents } = await supabase.from("entities").select("id, name, slug");
const idBySlug = new Map(ents.map((e) => [e.slug, e.id]));

// 1) create the 3 new categories (idempotent)
const NEW_CATS = [
  { slug: "personal", name: "Federal income tax" },
  { slug: "personal", name: "Legal & professional fees" },
  { slug: "keller", name: "Leasehold Improvements" },
];
for (const nc of NEW_CATS) {
  const entity_id = idBySlug.get(nc.slug);
  const { data: existing } = await supabase.from("categories").select("id").eq("entity_id", entity_id).eq("full_path", nc.name).maybeSingle();
  if (existing) { console.log(`exists: ${nc.slug}/${nc.name}`); continue; }
  const { error } = await supabase.from("categories").insert({ entity_id, name: nc.name, full_path: nc.name, parent_id: null, is_active: true });
  console.log(error ? `INSERT FAIL ${nc.slug}/${nc.name}: ${error.message}` : `created: ${nc.slug}/${nc.name}`);
}

// reload categories for id lookup
const { data: cats } = await supabase.from("categories").select("id, entity_id, full_path");
const catId = (slug, fullPath) => cats.find((c) => c.entity_id === idBySlug.get(slug) && c.full_path === fullPath)?.id ?? null;

const PLAN = {
  1: ["personal", "→ Austin ACAA (136 Anita)"], 2: ["personal", "Federal income tax"], 3: ["personal", "Legal & professional fees"],
  5: ["personal", "Intercompany — pending"], 6: ["personal", "Intercompany — pending"],
  7: ["keller", "Leasehold Improvements"], 8: ["keller", "Leasehold Improvements"], 9: ["keller", "Leasehold Improvements"],
  10: ["personal", "Intercompany — pending"], 11: ["personal", "Intercompany — pending"], 12: ["personal", "Federal income tax"],
  14: ["personal", "Intercompany — pending"], 15: ["personal", "Intercompany — pending"], 16: ["personal", "Intercompany — pending"],
  17: ["keller", "Job Supplies Expense"], 18: ["keller", "Leasehold Improvements"],
  20: ["personal", "Intercompany — pending"], 21: ["personal", "Intercompany — pending"],
  22: ["personal", "Personal travel & vacation"], 23: ["gbsl", "Credit card payment"],
  24: ["personal", "Intercompany — pending"], 25: ["personal", "Childcare & family"],
};

// 2) re-categorize
let done = 0;
const now = new Date().toISOString();
for (const [n, [slug, full]] of Object.entries(PLAN)) {
  const item = map[n];
  const cid = catId(slug, full);
  if (!cid) { console.log(`#${n} target missing ${slug}/${full}`); continue; }
  const { error } = await supabase
    .from("classifications")
    .update({ category_id: cid, classified_by: "alexbhp@gmail.com", classified_at: now })
    .eq("id", item.classificationId);
  if (error) { console.log(`#${n} update fail: ${error.message}`); continue; }
  done++;
}
console.log(`\nRe-categorized ${done}/22 transactions. Deferred: #4, #13, #19 (Keller transfers).`);

// 3) verify totals (with updated NON_EXPENSE incl new excluded categories)
const NON_EXPENSE = new Set([
  "Credit card payment", "Transfer / Zelle (personal)", "Refund / credit", "Intercompany — pending",
  "Security deposit movement", "→ GBSL business expense", "→ Keller business expense", "→ Austin ACAA (136 Anita)",
  "→ Pflugerville rental", "→ Personal (mis-posted)", "Mixed / pending allocation",
  "Federal income tax", "Leasehold Improvements",
]);
const all = [];
let off = 0;
while (true) {
  const { data } = await supabase.from("transactions").select("amount, classifications(entity_id, category_id, categories(full_path))").range(off, off + 999);
  if (!data?.length) break; all.push(...data); if (data.length < 1000) break; off += 1000;
}
for (const slug of ["personal", "keller", "gbsl"]) {
  const eId = idBySlug.get(slug);
  const rows = all.filter((r) => r.classifications?.entity_id === eId);
  const pos = rows.filter((r) => Number(r.amount) > 0);
  const exp = pos.filter((r) => r.classifications?.category_id != null && !NON_EXPENSE.has(r.classifications?.categories?.full_path ?? "")).reduce((s, r) => s + Number(r.amount), 0);
  const uncat = pos.filter((r) => r.classifications?.category_id == null);
  console.log(`${slug.padEnd(9)} expenses ${usd(exp).padStart(16)}   uncategorized ${uncat.length} (${usd(uncat.reduce((s,r)=>s+Number(r.amount),0))})`);
}
