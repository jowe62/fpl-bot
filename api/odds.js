// /api/odds  —  Vercel serverless-funktion
//
// Hämtar anytime-goalscorer- och clean sheet-odds för kommande Premier
// League-matcher från Odds-API.io, matchar spelare/lag mot FPL:s id:n,
// och returnerar sannolikheter i det format FPL-botens ODDS-plugin väntar.
//
// Miljövariabel som MÅSTE sättas i Vercel (Settings → Environment Variables):
//   ODDS_API_KEY = din nyckel från odds-api.io
//
// Nyckeln ligger ENDAST här på servern, aldrig i frontend.
//
// Anropas från artefakten som:  fetch("/api/odds")
// Svar:  { updated, byTeam: {fplTeamId: {csProb}}, byPlayer: {fplPlayerId: {anytimeProb, assistProb}} }

const ODDS_BASE = "https://api.odds-api.io/v3";
const FPL_BASE = "https://fantasy.premierleague.com/api";
const BOOKMAKERS = "Bet365,Unibet";
const LEAGUE = "england-premier-league";

// Enkel in-memory-cache. Vercel återanvänder ofta samma instans mellan
// anrop under en period, så detta räcker för att skydda kvoten. Vill du ha
// hårdare garanti kan du byta till Vercel KV, men detta duger för sajttrafik.
let CACHE = { data: null, ts: 0 };
const CACHE_MS = 6 * 60 * 60 * 1000; // 6 timmar

// ── Odds-API:ts lagnamn → FPL:s team.name ─────────────────────────────────
// Enbart ÄKTA namnskillnader hör hemma här, dvs där FPL använder en kortform
// som inte går att härleda ("Tottenham Hotspur" → "Spurs"). FC/AFC-affix
// hanteras av normTeam() och ska INTE listas här.
const TEAM_ALIASES = {
  "Manchester City": "Man City",
  "Manchester United": "Man Utd",
  "Tottenham Hotspur": "Spurs",
  "Nottingham Forest": "Nott'm Forest",
  "Newcastle United": "Newcastle",
  "Leeds United": "Leeds",
  "Brighton & Hove Albion": "Brighton",
  // Lag utanför årets PL, kvar för upp-/nedflyttning mellan säsonger.
  "Wolverhampton Wanderers": "Wolves",
  "West Ham United": "West Ham",
  "Leicester City": "Leicester",
};

// ── Namnnormalisering ──────────────────────────────────────────────────────
// Tar bort diakriter (ø→o, é→e, ï→i), gör gemener, trimmar. Används för att
// jämföra namn mellan böcker och mot FPL trots olika stavning.
function norm(s) {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // diakriter
    .replace(/ø/gi, "o").replace(/æ/gi, "ae").replace(/å/gi, "a")
    .replace(/ß/gi, "ss")
    .toLowerCase()
    .replace(/[^a-z\s-]/g, "")
    .trim();
}

// Lagnamn: odds-API:t returnerar klubbens officiella namn med FC/AFC-affix
// ("Everton FC", "Sunderland AFC", "AFC Bournemouth"), FPL gör aldrig det.
// Vi tar bort affixet i stället för att lista varje enordsklubb för hand —
// det var precis den handlistan som tyst tappade Arsenal, Brentford, Chelsea,
// Everton, Fulham och Liverpool.
function normTeam(s) {
  return norm(s).replace(/^a?fc\s+/, "").replace(/\s+a?fc$/, "").trim();
}

// Sista ordet i ett namn (efternamn). "Jørgen Strand Larsen" → "larsen".
// Fångar att en bok skriver mellannamn och en annan inte.
function lastName(s) {
  const parts = norm(s).split(/[\s-]+/).filter(Boolean);
  return parts[parts.length - 1] || "";
}

async function jget(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${url.split("?")[0]}`);
  return r.json();
}

// Decimalodds → implicerad sannolikhet, med grov marginaljustering.
// För anytime (ja/nej-marknad utan explicit nej) klipper vi bara 1/odds;
// det överskattar något pga vig, men räcker gott för ranking. Clean sheet
// har både ja och nej, så där normaliserar vi bort marginalen ordentligt.
function impliedProb(odds) {
  const o = parseFloat(odds);
  return o > 1 ? 1 / o : 0;
}

export default async function handler(req, res) {
  try {
    const key = process.env.ODDS_API_KEY;
    if (!key) throw new Error("ODDS_API_KEY saknas i miljön");

    // Servera cache om färsk.
    if (CACHE.data && Date.now() - CACHE.ts < CACHE_MS) {
      res.setHeader("X-Odds-Cache", "hit");
      return res.status(200).json(CACHE.data);
    }

    // 1. FPL: lag + spelare för id-matchning.
    const bs = await jget(`${FPL_BASE}/bootstrap-static/`);
    const fplTeams = bs.teams; // {id, name, short_name}
    const fplPlayers = bs.elements; // {id, web_name, second_name, team, ...}

    // Ett enda uppslag: normaliserat lagnamn → team.id. Både FPL:s egna namn
    // och alias-nycklarna normaliseras in i samma tabell, så uppslaget blir
    // ett steg och alias fungerar även med FC/AFC-affix ("Manchester City FC").
    const teamNameToId = {};
    for (const t of fplTeams) {
      teamNameToId[normTeam(t.name)] = t.id;
      teamNameToId[normTeam(t.short_name)] = t.id;
    }
    for (const [oddsName, fplName] of Object.entries(TEAM_ALIASES)) {
      const id = teamNameToId[normTeam(fplName)];
      if (id !== undefined) teamNameToId[normTeam(oddsName)] = id;
    }
    // Ett namn som inte går att mappa är ett trasigt antagande om upstream,
    // inte ett tomt resultat: vi samlar det och rapporterar det i svaret i
    // stället för att tyst returnera null.
    const unmappedTeams = new Set();
    function oddsTeamToFplId(oddsName) {
      const id = teamNameToId[normTeam(oddsName)];
      if (id === undefined) { unmappedTeams.add(oddsName); return null; }
      return id;
    }

    // Spelare per lag, indexerade på efternamn för snabb matchning.
    // {teamId: {lastName: [players...]}}
    const playersByTeamLast = {};
    for (const p of fplPlayers) {
      const ln = lastName(p.second_name || p.web_name);
      (playersByTeamLast[p.team] ??= {})[ln] ??= [];
      playersByTeamLast[p.team][ln].push(p);
    }
    function matchPlayer(oddsLabel, fplTeamId) {
      const ln = lastName(oddsLabel);
      const bucket = playersByTeamLast[fplTeamId]?.[ln];
      if (!bucket || bucket.length === 0) return null;
      if (bucket.length === 1) return bucket[0].id;
      // Flera med samma efternamn i laget: matcha även på förnamnsinitial.
      const oddsFirst = norm(oddsLabel).split(/[\s-]+/)[0] || "";
      const better = bucket.find(p => norm(p.first_name || "").startsWith(oddsFirst.slice(0, 3)));
      return (better || bucket[0]).id;
    }

    // 2. Odds-API: kommande PL-events.
    const events = await jget(
      `${ODDS_BASE}/events?sport=football&league=${LEAGUE}&apiKey=${key}`
    );
    const upcoming = events.filter(e => e.status === "pending");

    const byTeam = {};
    const byPlayer = {};

    // 3. Odds per match. Begränsa till nästa ~10 för att hålla nere anrop.
    const requested = upcoming.slice(0, 10);
    const failedEvents = [];
    for (const ev of requested) {
      let odds;
      try {
        odds = await jget(
          `${ODDS_BASE}/odds?eventId=${ev.id}&bookmakers=${BOOKMAKERS}&apiKey=${key}`
        );
      } catch (e) {
        // Räknas och rapporteras — en match som tappas ska aldrig försvinna tyst.
        failedEvents.push({ event: `${ev.home} v ${ev.away}`, error: String(e.message || e) });
        continue;
      }

      const homeFpl = oddsTeamToFplId(ev.home);
      const awayFpl = oddsTeamToFplId(ev.away);

      // Böckerna ligger under odds.bookmakers.{Bet365|Unibet} som en array
      // av marknader. Vi tar den första bok som har respektive marknad.
      const books = odds.bookmakers || {};
      const bookList = Object.values(books);

      const findMarket = name => {
        for (const markets of bookList) {
          const m = markets.find(mk => mk.name === name);
          if (m) return m;
        }
        return null;
      };

      // Clean sheet: "Clean Sheet Home"/"Away" har {yes,no}. Normalisera
      // bort marginalen: p = (1/oyes) / (1/oyes + 1/ono).
      const csHome = findMarket("Clean Sheet Home");
      const csAway = findMarket("Clean Sheet Away");
      const csProb = m => {
        const o = m?.odds?.[0];
        if (!o) return null;
        const y = impliedProb(o.yes), n = impliedProb(o.no);
        return y + n > 0 ? y / (y + n) : null;
      };
      if (homeFpl && csHome) { const p = csProb(csHome); if (p != null) byTeam[homeFpl] = { csProb: p }; }
      if (awayFpl && csAway) { const p = csProb(csAway); if (p != null) byTeam[awayFpl] = { csProb: p }; }

      // Anytime goalscorer: lista av {label, over}. Spelarens lag är antingen
      // hemma eller borta — vi provar båda och matchar på efternamn.
      const scorer = findMarket("Anytime Goalscorer");
      if (scorer) {
        for (const sel of scorer.odds) {
          const prob = impliedProb(sel.over);
          if (!prob) continue;
          let pid = homeFpl ? matchPlayer(sel.label, homeFpl) : null;
          if (!pid && awayFpl) pid = matchPlayer(sel.label, awayFpl);
          if (pid) (byPlayer[pid] ??= {}).anytimeProb = prob;
        }
      }

      // Assist via "Player To Score or Assist" → (Assist)-selektioner.
      const sa = findMarket("Player To Score or Assist");
      if (sa) {
        for (const sel of sa.odds) {
          if (!/\(Assist\)/i.test(sel.label)) continue;
          const prob = impliedProb(sel.over);
          if (!prob) continue;
          const clean = sel.label.replace(/\(.*?\)/g, "").trim();
          let pid = homeFpl ? matchPlayer(clean, homeFpl) : null;
          if (!pid && awayFpl) pid = matchPlayer(clean, awayFpl);
          if (pid) (byPlayer[pid] ??= {}).assistProb = prob;
        }
      }
    }

    // Täckning: gör det mätbart utifrån hur mycket av datan som faktiskt
    // blev odds, så boten kan säga sanningen i UI i stället för att påstå
    // att odds-modellen gäller alla.
    const payload = {
      updated: new Date().toISOString(),
      byTeam,
      byPlayer,
      coverage: {
        eventsRequested: requested.length,
        eventsFailed: failedEvents,
        teamsWithOdds: Object.keys(byTeam).length,
        unmappedTeams: [...unmappedTeams],
      },
    };
    CACHE = { data: payload, ts: Date.now() };
    res.setHeader("X-Odds-Cache", "miss");
    return res.status(200).json(payload);
  } catch (e) {
    // Ingen tyst fallback: säg tydligt att det gick fel, så artefakten
    // kan visa "odds ej tillgängligt" istället för att låtsas ha data.
    return res.status(502).json({ error: String(e.message || e) });
  }
}
