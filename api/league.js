// /api/league — er kompisliga, vecka för vecka
//
// FPL ger standings, och varje medlems /history/ ger poäng, rank, bänkpoäng,
// byten och chips per omgång. Med det går hela säsongen att följa: vem som
// klättrar om vem, vem som bränner chips, vem som lämnar poäng på bänken.
//
// Ligans egen standings-rank uppdateras bara mellan omgångar, så ordningen
// per omgång RÄKNAS här ur de kumulativa totalerna i stället för att läsas.
// Annars går det inte att rita hur ni passerar varandra.

const FPL_BASE = "https://fantasy.premierleague.com/api";
const CACHE_MS = 30 * 60 * 1000;   // ligan rör sig långsamt; en halvtimme räcker
const MAX_MEMBERS = 50;
// Kaptenshistorik hamtas per medlem OCH omgang. Utan tak blir det medlemmar
// gånger 38 anrop i maj, sa vi tar bara de senaste omgangarna.
const CAPTAIN_GWS = 6;

const FPL_HEADERS = {
  "User-Agent": "Mozilla/5.0",
  Referer: "https://fantasy.premierleague.com/",
};

const CACHE = new Map();

async function jget(url) {
  const r = await fetch(url, { headers: FPL_HEADERS });
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${url.split("?")[0]}`);
  return r.json();
}

export default async function handler(req, res) {
  try {
    const id = String(req.query.id || "").replace(/\D/g, "");
    if (!id) return res.status(400).json({ error: "Ange ?id=<liga-id>" });

    const hit = CACHE.get(id);
    if (hit && Date.now() - hit.ts < CACHE_MS) {
      res.setHeader("X-League-Cache", "hit");
      return res.status(200).json(hit.data);
    }

    const standings = await jget(`${FPL_BASE}/leagues-classic/${id}/standings/`);
    const members = (standings.standings?.results || []).slice(0, MAX_MEMBERS);
    if (!members.length) throw new Error("ligan har inga medlemmar");

    const histories = await Promise.all(
      members.map(m =>
        jget(`${FPL_BASE}/entry/${m.entry}/history/`)
          .then(h => ({ entry: m.entry, h }))
          .catch(() => null)
      )
    );
    const ok = histories.filter(Boolean);

    // Alla omgångar någon har spelat.
    const gws = [...new Set(ok.flatMap(x => x.h.current.map(e => e.event)))].sort((a, b) => a - b);

    // Per omgång: kumulativ total per medlem, och ordningen dem emellan.
    // Ligaposition räknas alltså fram, inte läses.
    const table = gws.map(gw => {
      const row = ok.map(({ entry, h }) => {
        const e = h.current.find(x => x.event === gw);
        return {
          entry,
          points: e?.points ?? null,
          total: e?.total_points ?? null,
          bench: e?.points_on_bench ?? null,
          hits: e?.event_transfers_cost ?? 0,
          transfers: e?.event_transfers ?? 0,
        };
      });
      const ranked = [...row].filter(r => r.total != null).sort((a, b) => b.total - a.total);
      const pos = new Map(ranked.map((r, i) => [r.entry, i + 1]));
      return { gw, rows: row.map(r => ({ ...r, pos: pos.get(r.entry) ?? null })) };
    });

    // Senast spelade omgang — for truppoverlapp och kaptensjamforelse.
    const lastGw = gws.length ? gws[gws.length - 1] : null;
    const capGws = gws.slice(-CAPTAIN_GWS);

    // En picks-hamtning per medlem och omgang i fonstret. Truppen tas ur den
    // sista, kaptenen ur varje.
    const pickJobs = [];
    for (const { entry } of ok)
      for (const gw of capGws)
        pickJobs.push(
          jget(`${FPL_BASE}/entry/${entry}/event/${gw}/picks/`)
            .then(d => ({ entry, gw, d }))
            .catch(() => null)
        );
    const picked = (await Promise.all(pickJobs)).filter(Boolean);

    const squads = {};      // entry -> [element-id] for sista omgangen
    const captains = {};    // entry -> { gw: element-id }
    for (const { entry, gw, d } of picked) {
      const cap = d.picks.find(p => p.is_captain);
      if (cap) (captains[entry] ??= {})[gw] = cap.element;
      if (gw === lastGw) squads[entry] = d.picks.map(p => p.element);
    }

    // Truppoverlapp: antal delade spelare mellan varje par.
    const overlap = {};
    const entries = Object.keys(squads);
    for (const a of entries) {
      const sa = new Set(squads[a]);
      overlap[a] = {};
      for (const b of entries) {
        if (a === b) continue;
        overlap[a][b] = squads[b].filter(id => sa.has(id)).length;
      }
    }

    const payload = {
      updated: new Date().toISOString(),
      lastGw, capGws, squads, captains, overlap,
      league: { id: +id, name: standings.league?.name ?? null },
      members: members.map(m => {
        const rec = ok.find(x => x.entry === m.entry);
        return {
          entry: m.entry,
          player: m.player_name,
          team: m.entry_name,
          total: m.total,
          rank: m.rank,
          lastRank: m.last_rank,
          chips: rec ? rec.h.chips.map(c => ({ name: c.name, event: c.event })) : [],
          seasons: rec ? rec.h.past.length : null,
        };
      }),
      gameweeks: gws,
      table,
    };

    CACHE.set(id, { data: payload, ts: Date.now() });
    res.setHeader("X-League-Cache", "miss");
    return res.status(200).json(payload);
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e) });
  }
}
