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
// Bindestreck hålls ihop: "Gibbs-White" är ett efternamn, inte "white".
// Delade vi på bindestreck kolliderade Gibbs-White med Ben White,
// Solanke-Mitchell med Tyrick Mitchell och Dewsbury-Hall med Lewis Hall.
function lastName(s) {
  const parts = norm(s).split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] || "";
}

// Namnformer att slå upp på: efternamnet som det står, plus ledet efter sista
// bindestrecket. Källorna är oense om bindestreck — boken skriver "Ben Doak"
// och "Ait Nouri" där FPL har "Gannon-Doak" och "Aït-Nouri". Båda formerna
// indexeras, och kravet på entydighet i matchPlayer ser till att den bredare
// uppslagningen inte kan gissa fel: blir det flera kandidater och förnamnet
// inte skiljer dem åt hoppas etiketten över.
function nameKeys(s) {
  const ln = lastName(s);
  if (!ln) return [];
  const tail = ln.split("-").pop();
  return tail && tail !== ln ? [ln, tail] : [ln];
}

// FPL svarar 403 på nakna anrop från moln-IP:n. api/fpl.js skickar därför
// dessa headers; odds.js gjorde det inte och dog sporadiskt med 403 på
// bootstrap-static. Samma headers, samma skäl.
const FPL_HEADERS = {
  "User-Agent": "Mozilla/5.0",
  Referer: "https://fantasy.premierleague.com/",
};

async function jget(url, headers) {
  const r = await fetch(url, headers ? { headers } : undefined);
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${url.split("?")[0]}`);
  return r.json();
}

// Decimalodds → rå implicerad sannolikhet. Bär bookmakerns marginal.
// Clean sheet har både ja och nej och normaliseras direkt där den läses.
// Anytime och assist saknar nej-sida och kalibreras i stället lagvis med
// calibrationExponent() nedan — rå 1/odds duger INTE.
function impliedProb(odds) {
  const o = parseFloat(odds);
  return o > 1 ? 1 / o : 0;
}

// Marginalen i anytime-marknaden är skevt fördelad: långskott är
// proportionellt mycket mer uppblåsta än favoriter. En potens krymper därför
// långskott hårdare, vilket är rätt form på korrigeringen — ett platt tal
// vore fel.
//
// Vi söker det alpha som får summan av sannolikheterna att landa på lagets
// förväntade antal mål. Summan av anytime-sannolikheter ÄR väntevärdet för
// antalet olika målskyttar (linjäritet — gäller oavsett hur mål korrelerar),
// och det kan aldrig överstiga förväntade mål. Mätt på skarp data låg summan
// 2,7 gånger över taket för samtliga 20 lag.
//
// Taket är något generöst, eftersom en spelare kan göra två mål. Kalibreringen
// krymper alltså aningen för lite och lämnar kvar en gnutta inflation. Det är
// avsiktligt: hellre underkorrigera än överkorrigera.
function calibrationExponent(probs, lambda) {
  const sum = a => probs.reduce((acc, p) => acc + p ** a, 0);
  if (sum(1) <= lambda) return 1; // redan under taket — rör inte
  let lo = 1, hi = 12;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (sum(mid) > lambda) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
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
    const bs = await jget(`${FPL_BASE}/bootstrap-static/`, FPL_HEADERS);
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

    // Spelare per lag, indexerade på både efternamn och web_name. FPL lägger
    // ofta det namn spelaren faktiskt kallas i fel fält — Igor Thiago heter
    // "Nascimento Rodrigues" i second_name men "Thiago" i web_name, och det
    // är det senare boken skriver.
    // Förnamn indexeras medvetet INTE: spelare som heter Wilson Isidor eller
    // Anthony Patterson i förnamn skulle då fånga etiketter avsedda för en
    // Wilson respektive Anthony i motståndarlaget.
    // {teamId: {namnform: [players...]}}
    const playersByTeamLast = {};
    for (const p of fplPlayers) {
      const keys = new Set([...nameKeys(p.second_name), ...nameKeys(p.web_name)]);
      for (const k of keys) ((playersByTeamLast[p.team] ??= {})[k] ??= []).push(p);
    }

    // Etiketter vi inte kunde knyta till exakt en spelare. Rapporteras i
    // svaret — en etikett som tappas ska aldrig försvinna tyst.
    const unmatched = new Set();
    const ambiguous = new Set();
    const playerTeam = Object.fromEntries(fplPlayers.map(p => [p.id, p.team]));

    // Matchar mot BÅDA lagen i matchen samtidigt. Den gamla varianten provade
    // hemmalaget först och tog första träffen, vilket skrev bortaspelarens
    // odds på en hemmaspelare med samma efternamn (Callum Wilson → Harry Wilson).
    function matchPlayer(oddsLabel, fplTeamIds) {
      const [full, tail] = nameKeys(oddsLabel);
      const collect = (key) => {
        const seen = new Map();
        for (const t of fplTeamIds)
          for (const p of playersByTeamLast[t]?.[key] ?? []) seen.set(p.id, p);
        return [...seen.values()];
      };
      // Exakt efternamnsform först. Vidga till ledet efter bindestrecket bara
      // om ingenting alls träffade — annars gör bokens "Giraud-Hutchinson"
      // etiketten "Gibbs-White" tvetydig mot Ben White i onödan. Vi gissar
      // aldrig mellan kandidater, vi letar bara vidare när listan är tom.
      let cands = collect(full);
      if (cands.length === 0 && tail) cands = collect(tail);
      if (cands.length === 0) { unmatched.add(oddsLabel); return null; }
      if (cands.length === 1) return cands[0].id;
      // Flera kandidater: förnamnet måste peka ut exakt en. Gör det inte det
      // hoppar vi över etiketten — en gissning här skriver en spelares odds
      // på en annan, vilket är värre än att sakna odds.
      const first = norm(oddsLabel).split(/\s+/)[0] || "";
      const byFirst = cands.filter(p => norm(p.first_name || "").startsWith(first));
      if (byFirst.length === 1) return byFirst[0].id;
      ambiguous.add(oddsLabel);
      return null;
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
    const calibration = {};          // fplTeamId -> exponent som användes
    const uncalibratedTeams = new Set();
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
      const fixtureTeams = [homeFpl, awayFpl].filter(Boolean);

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
      // Spelarsannolikheterna mellanlagras per match. Kalibreringen behöver
      // hela lagets lista, så ingenting skrivs till byPlayer förrän vi vet
      // vilken exponent som gäller.
      const staged = new Map(); // pid -> { team, anytimeProb, assistProb }
      const stage = (pid, field, prob) => {
        const e = staged.get(pid) ?? { team: playerTeam[pid] };
        e[field] = prob;
        staged.set(pid, e);
      };

      const scorer = findMarket("Anytime Goalscorer");
      if (scorer) {
        for (const sel of scorer.odds) {
          const prob = impliedProb(sel.over);
          if (!prob) continue;
          const pid = matchPlayer(sel.label, fixtureTeams);
          if (pid) stage(pid, "anytimeProb", prob);
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
          const pid = matchPlayer(clean, fixtureTeams);
          if (pid) stage(pid, "assistProb", prob);
        }
      }

      // Kalibrera bort marginalen, lagvis. Lagets förväntade mål kommer ur
      // MOTSTÅNDARENS clean sheet-odds, som redan är de-viggade:
      // P(laget gör 0 mål) = e^-lambda.
      for (const teamId of fixtureTeams) {
        const oppId = teamId === homeFpl ? awayFpl : homeFpl;
        const csOpp = oppId ? byTeam[oppId]?.csProb : null;
        const own = [...staged.values()].filter(e => e.team === teamId);
        const anytimes = own.map(e => e.anytimeProb).filter(Boolean);
        if (!anytimes.length) continue;
        if (csOpp == null) {
          // Utan clean sheet-ankare går marginalen inte att mäta. Vi lämnar
          // sannolikheterna råa och säger det i svaret hellre än att hitta på
          // en exponent.
          uncalibratedTeams.add(teamId);
          continue;
        }
        const alpha = calibrationExponent(anytimes, -Math.log(csOpp));
        calibration[teamId] = Number(alpha.toFixed(3));
        for (const e of own) {
          if (e.anytimeProb) e.anytimeProb = e.anytimeProb ** alpha;
          if (e.assistProb) e.assistProb = e.assistProb ** alpha;
        }
      }

      for (const [pid, e] of staged) {
        const t = (byPlayer[pid] ??= {});
        if (e.anytimeProb) t.anytimeProb = e.anytimeProb;
        if (e.assistProb) t.assistProb = e.assistProb;
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
        unmatchedLabels: { count: unmatched.size, sample: [...unmatched].slice(0, 25) },
        ambiguousLabels: { count: ambiguous.size, sample: [...ambiguous].slice(0, 25) },
        calibration,
        uncalibratedTeams: [...uncalibratedTeams],
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
