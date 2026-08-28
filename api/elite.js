// /api/elite — vad toppmanagerna faktiskt äger
//
// FPL exponerar inget kaptensfält i bootstrap, men varje managers lag är
// publikt. Genom att sampla toppen av overall-ligan får vi både ägarandel och
// KAPTENSANDEL, alltså den effective ownership som premiumsajter tar betalt
// för. Uppmätt: 20 lag på 0,3 sekunder parallellt.
//
// Anropen görs här på servern och cachas, så webbläsaren slipper göra dem vid
// varje laddning.
//
// VIKTIGT: tidigt på säsongen speglar topplistan tur, inte skicklighet. Svaret
// bär därför alltid med sig sitt urval och sin omgång så UI:t kan säga det.

const FPL_BASE = "https://fantasy.premierleague.com/api";
const OVERALL_LEAGUE = 314;   // "Overall" — alla managers
const SAMPLE = 50;            // två sidor av standings à 50; en räcker gott
const CACHE_MS = 6 * 60 * 60 * 1000;

const FPL_HEADERS = {
  "User-Agent": "Mozilla/5.0",
  Referer: "https://fantasy.premierleague.com/",
};

let CACHE = { data: null, ts: 0, gw: null };

async function jget(url) {
  const r = await fetch(url, { headers: FPL_HEADERS });
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${url.split("?")[0]}`);
  return r.json();
}

export default async function handler(req, res) {
  try {
    const bs = await jget(`${FPL_BASE}/bootstrap-static/`);
    // Vi kan bara läsa lag för en omgång som redan är spelad.
    const played = bs.events.filter(e => e.finished).map(e => e.id);
    const gw = played.length ? Math.max(...played) : null;
    if (!gw) throw new Error("ingen spelad omgång att sampla");

    if (CACHE.data && CACHE.gw === gw && Date.now() - CACHE.ts < CACHE_MS) {
      res.setHeader("X-Elite-Cache", "hit");
      return res.status(200).json(CACHE.data);
    }

    const standings = await jget(
      `${FPL_BASE}/leagues-classic/${OVERALL_LEAGUE}/standings/?page_standings=1`
    );
    const entries = (standings.standings?.results || []).slice(0, SAMPLE);
    if (!entries.length) throw new Error("topplistan var tom");

    const picks = await Promise.all(
      entries.map(e =>
        jget(`${FPL_BASE}/entry/${e.entry}/event/${gw}/picks/`).catch(() => null)
      )
    );
    const ok = picks.filter(Boolean);
    if (!ok.length) throw new Error("kunde inte läsa något lag");

    // Ägarandel räknas på hela truppen, kaptensandel på bandet. Startandel
    // sags separat eftersom en spelare på andras bänk inte ger dem poäng.
    const owned = {}, started = {}, captained = {}, chips = {};
    for (const d of ok) {
      for (const p of d.picks) {
        owned[p.element] = (owned[p.element] || 0) + 1;
        if (p.position <= 11) started[p.element] = (started[p.element] || 0) + 1;
        if (p.is_captain) captained[p.element] = (captained[p.element] || 0) + 1;
      }
      if (d.active_chip) chips[d.active_chip] = (chips[d.active_chip] || 0) + 1;
    }

    const n = ok.length;
    const pct = obj => Object.fromEntries(
      Object.entries(obj).map(([id, c]) => [id, +(c / n * 100).toFixed(1)])
    );

    const payload = {
      updated: new Date().toISOString(),
      gameweek: gw,
      sampled: n,
      requested: entries.length,
      owned: pct(owned),
      started: pct(started),
      captained: pct(captained),
      chips: pct(chips),
      // Effective ownership: andelen lag där spelarens poäng räknas, med
      // kaptenerna dubbelräknade. Det är definitionen sajterna använder.
      effective: Object.fromEntries(
        Object.keys(started).map(id => [
          id,
          +(((started[id] || 0) + (captained[id] || 0)) / n * 100).toFixed(1),
        ])
      ),
    };

    CACHE = { data: payload, ts: Date.now(), gw };
    res.setHeader("X-Elite-Cache", "miss");
    return res.status(200).json(payload);
  } catch (e) {
    // Ingen tyst fallback: säg att det gick fel så UI:t kan låta bli att visa
    // siffror i stället för att visa påhittade.
    return res.status(502).json({ error: String(e.message || e) });
  }
}
