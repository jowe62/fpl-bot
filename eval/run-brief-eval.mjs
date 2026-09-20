// Kor riktiga briefs genom den DEPLOYADE endpointen och mater om de ar
// forankrade. Ingen nyckel behovs lokalt: nyckeln ligger i Vercel, och det ar
// exakt den vag en anvandare gar.
//
//   node eval/run-brief-eval.mjs [url]
//
// Avslutar med kod 1 om nagon brief ar oforankrad, sa den kan koras i CI.
import { checkBrief } from "./grounding.mjs";
import { fixtures } from "./fixtures.mjs";

const BAS = process.argv[2] || "https://fpl-bot-lovat.vercel.app";
const FPL = "https://fantasy.premierleague.com/api/bootstrap-static/";

// Namnregistret ar hela ligan — inte bara truppen. Det ar det som gor
// namnkontrollen skarp: en spelare som finns i PL men inte i payloaden ar
// pahittad, aven om namnet later rimligt.
async function byggUniverse(){
  const r = await fetch(FPL, {headers:{"User-Agent":"Mozilla/5.0"}});
  if(!r.ok) throw new Error(`FPL bootstrap svarade ${r.status}`);
  const bs = await r.json();
  const namn = new Set();
  for(const p of bs.elements) namn.add(p.web_name);
  for(const t of bs.teams){ namn.add(t.name); namn.add(t.short_name); }
  // Namn kortare an 3 tecken matchar for latt inuti vanlig text.
  return [...namn].filter(n=>n.length>=3);
}

async function skrivBrief(payload){
  const r = await fetch(`${BAS}/api/briefing`, {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify(payload),
  });
  const kropp = await r.text();
  if(!r.ok) throw new Error(`/api/briefing svarade ${r.status}: ${kropp.slice(0,200)}`);
  const data = JSON.parse(kropp);
  if(!data.text) throw new Error("svaret saknade text");
  return data.text;
}

const universe = await byggUniverse();
console.log(`Namnregister: ${universe.length} spelare och lag fran FPL.`);
console.log(`Endpoint: ${BAS}/api/briefing\n`);

let fel = 0;
for(const f of fixtures){
  let text;
  try { text = await skrivBrief(f.payload); }
  catch(e){ console.log(`TRASIG  ${f.namn}\n        ${e.message}\n`); fel++; continue; }

  const r = checkBrief({text, payload:f.payload, universe});
  if(!r.ok) fel++;
  console.log(`${r.ok?"FORANKRAD":"OFORANKRAD"}  ${f.namn}  (${text.split(/\s+/).length} ord)`);
  for(const b of r.brott) console.log(`        -> ${b.typ}: ${b.varfor}`);
  console.log(`        ${text.replace(/\n+/g," ").slice(0,150)}...\n`);
}

console.log(fel===0
  ? `Alla ${fixtures.length} briefs forankrade.`
  : `${fel} av ${fixtures.length} briefs underkanda.`);
process.exit(fel===0?0:1);
