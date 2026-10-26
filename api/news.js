// /api/news  —  Vercel serverless-funktion
//
// Hämtar Fantasy Football Scouts RSS-flöde och returnerar rubrikerna.
//
// VARFÖR BARA DEN KÄLLAN: jag mätte fyra flöden mot truppen. BBC, Guardian
// och Sky ger matchreferat och krönikor — av 254 poster namngavs noll av de
// femton spelarna på ett användbart sätt, och namnmatchningen gav falska
// träffar direkt ("Ashley Williams" expertkommentatorn mot spelaren
// N.Williams). FF Scout är FPL-specifikt och skriver på spelarnivå:
// "FPL notes: Pedro injury latest", "2pm team news: Bruno, Wissa benched".
// Informationen ligger i rubriken, så artiklarna behöver aldrig hämtas.
//
// Funktionen TOLKAR INGENTING. Den hämtar, parsar RSS och lämnar vidare.
// Matchningen mot din trupp görs i klienten, som har hela spelarregistret.
// Rubrikerna är någon annans påståenden och ska behandlas som text att läsa,
// aldrig som data som flyttar en siffra i modellen.
//
// Anropas som:  fetch("/api/news")
// Svar:  { updated, source, items: [{ title, link, ts }] }

const FEED = "https://www.fantasyfootballscout.co.uk/feed/";
const MAX_ITEMS = 40;

// Flödet hinner inte ändras oftare än så, och ingen vill DDoS:a en sajt man
// lånar rubriker från.
let CACHE = { data: null, ts: 0 };
const CACHE_MS = 20 * 60 * 1000;

function textOf(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  if (!m) return null;
  let v = m[1].trim();
  const cdata = v.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) v = cdata[1];
  return v
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&#8217;/g, "'")
    .replace(/&nbsp;/g, " ").replace(/&#8211;|&#8212;/g, "-")
    .replace(/\s+/g, " ")
    .trim() || null;
}

export default async function handler(req, res) {
  try {
    if (CACHE.data && Date.now() - CACHE.ts < CACHE_MS) {
      res.setHeader("X-News-Cache", "hit");
      return res.status(200).json(CACHE.data);
    }

    const r = await fetch(FEED, {
      redirect: "follow",
      headers: { "User-Agent": "GlennOS/1.0 (personligt FPL-verktyg)" },
    });
    if (!r.ok) throw new Error(`Flödet svarade ${r.status}`);
    const xml = await r.text();

    const block = xml.match(/<item[\s\S]*?<\/item>/g);
    // Ett tomt flöde är inte en tom lista. Antingen har sajten lagt om sitt
    // format eller så är något annat fel, och det ska synas i stället för att
    // tyst visas som "inga nyheter".
    if (!block || !block.length) throw new Error("Inga poster i flödet — formatet kan ha ändrats");

    const items = block.slice(0, MAX_ITEMS).map(b => {
      const title = textOf(b, "title");
      const link = textOf(b, "link");
      const date = textOf(b, "pubDate");
      const ts = date ? Date.parse(date) : null;
      return { title, link, ts: Number.isFinite(ts) ? ts : null };
    }).filter(i => i.title && i.link);

    if (!items.length) throw new Error("Inga poster gick att tolka ur flödet");

    const payload = {
      updated: new Date().toISOString(),
      source: "Fantasy Football Scout",
      items,
    };
    CACHE = { data: payload, ts: Date.now() };
    res.setHeader("X-News-Cache", "miss");
    return res.status(200).json(payload);
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e) });
  }
}
