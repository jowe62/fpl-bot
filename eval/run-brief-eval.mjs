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

// Modellen ar icke-deterministisk: samma payload ger olika text varje gang.
// En korning per fixtur bevisar darfor ingenting — vi mater en ANDEL.
const N = Number(process.env.N || 3);
console.log(`${N} korningar per fixtur.\n`);

let totalt = 0, fel = 0;
for(const f of fixtures){
  const brott = [];
  let ord = 0, ok = 0;
  for(let i = 0; i < N; i++){
    totalt++;
    let text;
    try { text = await skrivBrief(f.payload); }
    catch(e){ fel++; brott.push(`korning ${i+1} TRASIG: ${e.message}`); continue; }
    ord += text.split(/\s+/).length;
    const r = checkBrief({text, payload:f.payload, universe});
    if(r.ok) ok++; else { fel++; for(const b of r.brott) brott.push(`korning ${i+1}: ${b.typ} — ${b.varfor}`); }
    if(i === 0) console.log(`  exempel: ${text.replace(/\n+/g," ").slice(0,130)}...`);
  }
  console.log(`${ok}/${N} forankrade  ${f.namn}  (snitt ${Math.round(ord/N)} ord)`);
  for(const b of brott) console.log(`        -> ${b}`);
  console.log();
}

const andel = ((totalt-fel)/totalt*100).toFixed(0);
console.log(`RESULTAT: ${totalt-fel}/${totalt} forankrade (${andel}%)`);
process.exit(fel===0?0:1);
