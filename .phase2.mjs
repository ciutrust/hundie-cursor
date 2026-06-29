import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
function loadEnv(p){const e={};if(!existsSync(p))return e;for(const l of readFileSync(p,"utf8").split("\n")){const t=l.trim();if(!t||t.startsWith("#"))continue;const i=t.indexOf("=");if(i===-1)continue;let v=t.slice(i+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);e[t.slice(0,i).trim()]=v;}return e;}
const env=loadEnv(resolve(process.cwd(),".env.local"));
const supabase=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY);
const usd=(n)=>"$"+n.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const { data: ents } = await supabase.from("entities").select("id, slug");
const idBySlug=new Map(ents.map(e=>[e.slug,e.id]));

// 1) create the 14 new categories (idempotent)
const NEW=[
  ["keller","Membership revenue"],
  ["personal","Salary & wages"],["personal","Investment proceeds"],["personal","Interest income"],["personal","Other income"],
  ["acaa-austin","Rent income"],["pflugerville","Rent income"],
  ["personal","Owner Contribution"],["personal","Owner Distribution"],
  ["gbsl","Owner Contribution"],["gbsl","Owner Distribution"],
  ["keller","Leasehold improvements"],["keller","Tenant improvement allowance"],
  ["acaa-austin","Property purchase"],
];
let created=0;
for(const [slug,name] of NEW){
  const eid=idBySlug.get(slug);
  const {data:ex}=await supabase.from("categories").select("id").eq("entity_id",eid).eq("full_path",name).maybeSingle();
  if(ex) continue;
  const {error}=await supabase.from("categories").insert({entity_id:eid,name,full_path:name,parent_id:null,is_active:true});
  if(error){console.log(`insert fail ${slug}/${name}: ${error.message}`);continue;}
  created++;
}
console.log(`Created ${created} new categories (of ${NEW.length}; rest already existed).`);

// 2) flip the GBSL Membership Income rows to inflows (negative)
const {data:miCat}=await supabase.from("categories").select("id").eq("entity_id",idBySlug.get("gbsl")).eq("full_path","Membership Income").maybeSingle();
const all=[];let off=0;
while(true){const{data}=await supabase.from("transactions").select("id, amount, classifications(category_id)").range(off,off+999);if(!data?.length)break;all.push(...data);if(data.length<1000)break;off+=1000;}
const mi=all.filter(r=>r.classifications?.category_id===miCat.id);
let flipped=0;
for(const r of mi){
  const neg=-Math.abs(Number(r.amount));
  if(Number(r.amount)===neg) continue; // already negative
  const {error}=await supabase.from("transactions").update({amount:neg}).eq("id",r.id);
  if(error){console.log(`flip fail ${r.id}: ${error.message}`);continue;}
  flipped++;
}
console.log(`Flipped ${flipped} Membership Income rows to inflows (negative).`);

// 3) verify GBSL expense + income with the new kinds
const NON_EXPENSE=new Set(["Credit card payment","Transfer / Zelle (personal)","Refund / credit","Security deposit movement","→ GBSL business expense","→ Keller business expense","→ Austin ACAA (136 Anita)","→ Pflugerville rental","→ Personal (mis-posted)","Mixed / pending allocation","Sales Tax Payable","Intercompany — pending","Owner Contribution","Owner Distribution","Owners Equity","Owners Equity:Owner Distribution","Leasehold improvements","Tenant improvement allowance","Property purchase"]);
const INCOME=new Set(["Membership Income","Membership revenue","Salary & wages","Investment proceeds","Interest income","Other income","Rent income"]);
const all2=[];off=0;
while(true){const{data}=await supabase.from("transactions").select("amount, classifications(entity_id, category_id, categories(full_path))").range(off,off+999);if(!data?.length)break;all2.push(...data);if(data.length<1000)break;off+=1000;}
const g=all2.filter(r=>r.classifications?.entity_id===idBySlug.get("gbsl"));
const exp=g.filter(r=>{const p=r.classifications?.categories?.full_path;return r.classifications?.category_id!=null&&Number(r.amount)>0&&!NON_EXPENSE.has(p??"")&&!INCOME.has(p??"");}).reduce((s,r)=>s+Number(r.amount),0);
const inc=g.filter(r=>INCOME.has(r.classifications?.categories?.full_path??"")&&Number(r.amount)<0).reduce((s,r)=>s+Math.abs(Number(r.amount)),0);
console.log(`\nGBSL expenses now: ${usd(exp)}  (was ~$1,091,372 — expect ~$1,075,317 after −$16,055 correction)`);
console.log(`GBSL income now:   ${usd(inc)}  (Membership Income surfaced)`);
