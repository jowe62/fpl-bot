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
// Bokmakare. Parametern ar OBLIGATORISK — utan den svarar API:t
// "400 Invalid parameters: Missing bookmakers". Det provade jag, och det
// gick fel: jag tog bort parametern helt och pushade utan att testa.
//
// Sa har fungerar leverantorens plan: man VALJER vilka bokmakare som ska
// ingå i svaren, och planen bestammer hur manga platser man har. Gratis ger
// tva platser. Att be om en bokmakare man inte valt ger 403, vilket var det
// ursprungliga felet: koden bad om "Bet365,Unibet" och Bet365 ligger bakom
// betalplan, sa VARJE matchanrop nekades och hela oddsmodellen lag nere.
//
// Varde ur miljon sa en andring av valet i panelen inte kraver en kodandring.
// Standard ar den bokmakare kontot faktiskt har valt.
// Namnen ar hamtade ordagrant ur /v3/bookmakers, inte gissade: "Unibet" och
// "William Hill" med mellanslag. Listan har 458 poster med flera snarlika
// (Unibet UK, Unibet SE, WilliamHill NJ), sa stavningen spelar roll.
//
// Tva bokmakare ger battre tackning utan att kosta fler anrop: uppslaget
// nedan tar forsta boken som har marknaden, sa saknas malskytt hos den ena
// fylls luckan av den andra.
// MASTE matcha de bokmakare kontot har VALT i panelen. Att be om en bok som
// inte ligger i en slot ger 403 pa HELA anropet, inte bara pa den boken, sa
// listan far aldrig halka efter panelen. Det har hant tva ganger nu: forst
// med Bet365 (betalplan), sedan 2026-10-29 nar slotarna byttes till
// Unibet + Paddy Power medan koden fortfarande bad om William Hill.
const BOOKMAKERS = process.env.ODDS_BOOKMAKERS || "Unibet,Paddy Power";
// Kommat ar LISTANS avgransare och ska vara literalt i URL:en. Bara
// innehallet i varje namn kodas, dar mellanslaget i "William Hill" blir %20.
//
// Forut kordes hela strangen genom encodeURIComponent, vilket gav
// "Unibet%2CWilliam%20Hill" - alltsa en kodad avgransare. Unibet kom anda
// igenom, men William Hill dok aldrig upp i svaret trots att den var vald och
// sparad i panelen (2/2 slots, bada markta Saved, matt pa skarmbild
// 2026-10-29). Det ar fel enligt spec oavsett utfall, och den enda rimliga
// forklaringen till att ett namn MED mellanslag faller medan ett utan
// fungerar.
const BOOKMAKER_PARAM = BOOKMAKERS.split(",")
  .map(s => encodeURIComponent(s.trim()))
  .join(",");
const LEAGUE = "england-premier-league";
const MAX_EVENTS = 20;
// /odds/multi tar max tio eventIds och RAKNAS SOM ETT ANROP. Forut gjorde
// koden ett anrop per match, sa en uppdatering kostade elva av gratisplanens
// hundra i timmen. Nu kostar den tva: ett for /events och ett for matcherna.
// Det var inte en optimering utan orsaken till att vi slog i taket och fick
// 429 pa samtliga tio matcher 2026-10-29.
const CHUNK = 10;

// Enkel in-memory-cache. Vercel återanvänder ofta samma instans mellan
// anrop under en period, så detta räcker för att skydda kvoten. Vill du ha
// hårdare garanti kan du byta till Vercel KV, men detta duger för sajttrafik.
let CACHE = { data: null, ts: 0 };
const CACHE_MS = 6 * 60 * 60 * 1000; // 6 timmar

// CDN-cache. Minnescachen ovan lever bara sa lange Vercel haller instansen
// vid liv, och varje kallstart tommer den. En kallstart kostar TRE anrop
// uppstroms: FPL:s bootstrap, /events och ett /odds/multi. Tva av dem racknas
// mot oddskvoten. (Fore CHUNK var det tolv, darav 429:orna.) Utan den har headern
// cachade CDN:en ingenting (x-vercel-cache: MISS varje gang), sa varje
// sidladdning riskerade en full omhamtning.
//
// Med s-maxage serveras svaret fran kanten i sex timmar utan att funktionen
// ens kors. stale-while-revalidate later en besokare fa forra svaret direkt
// medan en uppdatering sker i bakgrunden, i stallet for att vanta.
//
// Nyttolasten bar sitt eget "updated"-faltet, sa alderen gar alltid att lasa
// ur svaret. Ett cachat svar utger sig aldrig for att vara farskare an det ar.
//
// Sätts BARA pa lyckade svar. Ett 502 ska inte cachas i sex timmar.
const CDN_CACHE = "public, s-maxage=21600, stale-while-revalidate=3600";

// Ett svar DAR INGA ODDS KOM IGENOM far inte cachas som om det vore data.
// Funktionen sparade forut sitt resultat oavsett utfall, sa nar leverantoren
// svarade 403 pa alla tio matcher lag det tomma svaret kvar i sex timmar -
// och boten fortsatte visa "inga odds" aven efter att leverantoren hamtat
// sig. Uppmatt: updated-stampeln stod stilla medan nya anrop gjordes.
//
// Men inte heller noll cache: med 100 anrop i timmen hos leverantoren skulle
// varje sidladdning under ett avbrott kosta nya anrop och gora saken varre.
// Tio minuter later den aterhamta sig snabbt utan att hammras: sex
// uppdateringar i timmen gånger tva anrop ar 12 av 100. Med den gamla
// endpointen hade samma tio minuter kostat 66 i timmen, vilket ar att
// hammra - det var halva orsaken till att kvoten tog slut.
const CDN_CACHE_TOMT = "public, s-maxage=600, must-revalidate";
const CACHE_MS_TOMT = 10 * 60 * 1000;

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
// Partiklar i sammansatta namn. De är aldrig det namn någon kallas vid, och
// skulle bara skapa kollisioner ("de" finns i dussintals namn).
const NAME_PARTICLES = new Set(["de","da","do","dos","das","del","della","van","von",
  "der","den","di","du","la","le","el","al","bin","ibn","abu","san","st","y"]);

// Varje led i ett efternamn som kan vara det spelaren kallas vid. Iberiska och
// brasilianska namn bär två efternamn där det FÖRSTA är det som används —
// "Yéremy Pino Santos" heter Pino, "Bruno Guimarães Rodriguez Moura" heter
// Guimarães. lastName() tar sista ordet och missar dem båda.
function surnameTokens(s) {
  return norm(s).split(/\s+/).filter(t => t.length >= 3 && !NAME_PARTICLES.has(t));
}

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

// Odds-API skickar kvoten pa VARJE svar:
//   x-ratelimit-limit / -remaining / -reset
// Utan att lasa dem gick "slut pa kvoten" inte att skilja fran "leverantoren
// krånglar" - bada syns bara som HTTP 429 pa varje match. Nu star siffran i
// svaret, sa den gar att lasa utan att gissa.
//
// Sinken skickas in i stallet for att ligga pa modulnivå: en varm
// Lambda-instans delas mellan anrop och skulle da rapportera en gammal
// matning som om den var farsk.
async function oget(url, kvot) {
  const r = await fetch(url);
  const limit = r.headers.get("x-ratelimit-limit");
  if (limit != null) {
    kvot.limit = Number(limit);
    kvot.remaining = Number(r.headers.get("x-ratelimit-remaining"));
    kvot.reset = r.headers.get("x-ratelimit-reset");
  }
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

// Poisson: P(X <= k). Samma fordelningsantagande som xP-modellen redan gor
// pa clean sheet-sidan (exp(-lambda)), alltsa inget nytt antagande.
function poissonCdf(k, lambda) {
  let term = Math.exp(-lambda), sum = term;
  for (let i = 1; i <= k; i++) { term *= lambda / i; sum += term; }
  return sum;
}

// Lagets forvantade mal (lambda) ur "Team Total Home"/"Team Total Away".
//
// VARFOR DEN MARKNADEN: ankaret var forut clean sheet, ur vilken lambda
// deriverades som -log(P(0 mal)). Den marknaden finns inte. Matt 2026-10-29
// via coverage.marketsSeen bjuder Unibet 48 marknader pa PL-matcher och clean
// sheet ar ingen av dem. Lagtotalen finns, och ar ett BATTRE ankare: den ger
// hela mallinjen i stallet for bara sannolikheten for noll mal.
//
// Marknaden ar tvasidig (over/under pa en linje), sa marginalen gar att
// normalisera bort rad for rad: P(over) = (1/o_over) / (1/o_over + 1/o_under).
//
// Bara HALVLINJER anvands. Pa en heltalslinje (hdp 2) ar exakt tva mal en
// push, sa over och under summerar inte till ett ens efter de-vigging, och
// att behandla den som en halvlinje vore ett modellfel.
//
// Lambda sokes sa att Poisson-modellen traffar alla linjer sa bra som
// mojligt. Boken bjuder normalt tva till fyra, och att anvanda allihop ar
// stabilare an att lita pa en enda. Rutsokning i stallet for binarsokning:
// felet ar monotont per punkt men summan behover inte vara det, och 600
// utvarderingar ar gratis.
function lambdaFromTeamTotal(market) {
  const punkter = [];
  for (const rad of market?.odds ?? []) {
    const hdp = Number(rad.hdp);
    if (!Number.isFinite(hdp) || Number.isInteger(hdp)) continue;
    const o = impliedProb(rad.over), u = impliedProb(rad.under);
    if (!(o > 0 && u > 0)) continue;
    punkter.push({ k: Math.floor(hdp), p: o / (o + u) });
  }
  if (!punkter.length) return null;
  const fel = lam => punkter.reduce(
    (a, pt) => a + ((1 - poissonCdf(pt.k, lam)) - pt.p) ** 2, 0);
  let bast = null, bastFel = Infinity;
  for (let lam = 0.05; lam <= 6.0001; lam += 0.01) {
    const f = fel(lam);
    if (f < bastFel) { bastFel = f; bast = lam; }
  }
  return bast;
}

export default async function handler(req, res) {
  try {
    const key = process.env.ODDS_API_KEY;
    if (!key) throw new Error("ODDS_API_KEY saknas i miljön");

    // Servera cache om färsk.
    // Ett tomt svar far bara leva tio minuter, ett riktigt sex timmar.
    const cacheAlder = CACHE.data
      ? (Object.keys(CACHE.data.byTeam || {}).length > 0 ? CACHE_MS : CACHE_MS_TOMT)
      : 0;
    if (CACHE.data && Date.now() - CACHE.ts < cacheAlder) {
      res.setHeader("X-Odds-Cache", "hit");
      res.setHeader("Cache-Control",
        Object.keys(CACHE.data.byTeam || {}).length > 0 ? CDN_CACHE : CDN_CACHE_TOMT);
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
    // Indexet är avsiktligt brett: varje led i efternamnet läggs in, eftersom
    // boken använder ETT av dem och vi inte vet vilket. Precisionen ligger inte
    // i hur smalt vi indexerar utan i kravet på entydighet i matchPlayer —
    // flera kandidater som förnamnet inte skiljer åt hoppas över.
    const playersByTeamLast = {};
    for (const p of fplPlayers) {
      const keys = new Set();
      for (const src of [p.second_name, p.web_name]) {
        for (const k of nameKeys(src)) keys.add(k);
        for (const t of surnameTokens(src)) for (const k of nameKeys(t)) keys.add(k);
      }
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
    const kvot = { limit: null, remaining: null, reset: null };
    const events = await oget(
      `${ODDS_BASE}/events?sport=football&league=${LEAGUE}&apiKey=${key}`, kvot
    );
    const upcoming = events.filter(e => e.status === "pending");

    const byTeam = {};
    const byPlayer = {};
    // Vilka marknader varje bokmakare faktiskt bjuder. Utan den har listan
    // gick det inte att se SKILLNADEN mellan "boken saknar clean sheet" och
    // "boken kallar den nagot annat an vi slar upp pa" - bada ser ut som noll
    // lag.
    //
    // PER BOK, inte sammanslaget. Den forsta versionen slog ihop allt, och da
    // gick det inte att se om en bok svarat alls eller vad just den bjuder.
    // Det var precis fragan nar William Hill inte syntes i svaret trots att
    // den var vald OCH sparad i panelen (2/2 slots, bada grona).
    //
    // Nycklarna ar ocksa enda kallan till vilka bokmakare som svarade, sa det
    // finns bara ett stalle att halla uppdaterat.
    const marknaderPerBok = new Map();

    // 3. Vilka matcher hör till NÄSTA omgång?
    //
    // Den gamla varianten tog de tio första pending-matcherna. Det antog dels
    // att listan kom i datumordning, dels att en omgång alltid är tio matcher.
    // Ingetdera håller: vid en dubbelomgång spelar vissa lag två gånger och vid
    // en blank spelar färre lag, så snittet blir fel åt båda hållen.
    //
    // FPL:s deadline avgör saken. En omgång är precis de matcher som ligger
    // mellan sin egen deadline och nästa omgångs deadline.
    const nextEvent = bs.events.find(e => e.is_next);
    if (!nextEvent) throw new Error("FPL har ingen kommande omgång (is_next saknas)");
    const after = bs.events.find(e => e.id === nextEvent.id + 1);
    const from = new Date(nextEvent.deadline_time).getTime();
    const until = after
      ? new Date(after.deadline_time).getTime()
      : from + 14 * 24 * 3600 * 1000;   // säsongens sista omgång har ingen efterföljare

    const inWindow = upcoming
      .filter(e => { const t = new Date(e.date).getTime(); return t >= from && t < until; })
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    // Taket skyddar gratiskvoten (100 anrop/h) om fönstret mot förmodan skulle
    // svälla. En dubbelomgång ligger normalt runt 14-16 matcher, alltsa tva
    // klumpar och tva anrop.
    const requested = inWindow.slice(0, MAX_EVENTS);
    const failedEvents = [];
    const calibration = {};          // fplTeamId -> exponent som användes
    const uncalibratedTeams = new Set();

    // Hamta oddsen i klumpar om tio. Ett fallerat anrop faller nu pa tio
    // matcher i stallet for en, sa var och en av dem rapporteras for sig -
    // en match som tappas ska aldrig forsvinna tyst.
    // Om lagtotalen FINNS men inget lambda gick att lasa ur den ar det
    // faltnamnen som inte stammer, inte tackningen. Da sparas ett ratt prov
    // sa orsaken syns i samma svar, i stallet for att krava en ny deploy for
    // att overhuvudtaget se hur raderna ser ut. Normalt ar den null.
    let teamTotalSample = null;
    let assistSample = null;
    const oddsPerEvent = new Map();
    for (let i = 0; i < requested.length; i += CHUNK) {
      const klump = requested.slice(i, i + CHUNK);
      const ids = klump.map(e => e.id).join(",");
      let svar;
      try {
        svar = await oget(
          `${ODDS_BASE}/odds/multi?eventIds=${ids}&bookmakers=${BOOKMAKER_PARAM}&apiKey=${key}`, kvot
        );
      } catch (e) {
        for (const ev of klump)
          failedEvents.push({ event: `${ev.home} v ${ev.away}`, error: String(e.message || e) });
        continue;
      }
      // Kontraktet sager "array of event odds objects". Nagot annat ar ett
      // trasigt antagande om upstream och ska braka, inte tolkas.
      if (!Array.isArray(svar)) throw new Error("/odds/multi svarade inte med en array");
      for (const o of svar) oddsPerEvent.set(o.id, o);
      for (const ev of klump)
        if (!oddsPerEvent.has(ev.id))
          failedEvents.push({ event: `${ev.home} v ${ev.away}`, error: "saknas i /odds/multi-svaret" });
    }

    for (const ev of requested) {
      const odds = oddsPerEvent.get(ev.id);
      if (!odds) continue;   // redan rapporterad i failedEvents

      const homeFpl = oddsTeamToFplId(ev.home);
      const awayFpl = oddsTeamToFplId(ev.away);
      const fixtureTeams = [homeFpl, awayFpl].filter(Boolean);

      // Böckerna ligger under odds.bookmakers.{Bet365|Unibet} som en array
      // av marknader. Vi tar den första bok som har respektive marknad.
      const books = odds.bookmakers || {};
      const bookList = Object.values(books);
      for (const [namn, markets] of Object.entries(books)) {
        const set = marknaderPerBok.get(namn) ?? new Set();
        for (const mk of markets) set.add(mk.name);
        marknaderPerBok.set(namn, set);
      }

      // Rikaste varianten av marknaden, inte den forsta. Nar tva bocker bada
      // har samma marknad avgjorde forut nyckelordningen i JSON-svaret vilken
      // som vann, vilket ar godtyckligt. Matt 2026-10-29: Paddy Power kom
      // forst och listade farre malskyttar an Unibet, sa 28 spelare foll bort
      // utan att nagot sade ifran.
      //
      // Marknaden tas fortfarande fran EN bok, aldrig sammanslagen. Bockerna
      // har olika marginal, och kalibreringen anpassar en exponent per lag -
      // en blandad lista skulle gora den exponenten meningslos.
      const findMarket = name => {
        let bast = null;
        for (const markets of bookList) {
          const m = markets.find(mk => mk.name === name);
          if (m && (!bast || (m.odds?.length ?? 0) > (bast.odds?.length ?? 0))) bast = m;
        }
        return bast;
      };

      // Lagens forvantade mal, direkt ur bokens egen lagtotal. Se
      // lambdaFromTeamTotal ovan for varfor clean sheet-marknaden inte
      // anvands langre: den finns inte hos bokmakaren.
      const lamHome = lambdaFromTeamTotal(findMarket("Team Total Home"));
      const lamAway = lambdaFromTeamTotal(findMarket("Team Total Away"));
      const lambdaFor = new Map();
      if (homeFpl) lambdaFor.set(homeFpl, lamHome);
      if (awayFpl) lambdaFor.set(awayFpl, lamAway);

      if (teamTotalSample === null) {
        for (const [namn, lam] of [["Team Total Home", lamHome], ["Team Total Away", lamAway]]) {
          const mk = findMarket(namn);
          if (mk && lam == null) {
            teamTotalSample = { market: namn, odds: (mk.odds || []).slice(0, 4) };
            break;
          }
        }
      }

      // Hallen nolla ar MOTSTANDARENS lambda: laget haller nollan precis nar
      // motstandaren gor noll mal, alltsa P = e^-lambda(motstandaren).
      if (awayFpl && lamHome != null) byTeam[awayFpl] = { csProb: Math.exp(-lamHome) };
      if (homeFpl && lamAway != null) byTeam[homeFpl] = { csProb: Math.exp(-lamAway) };

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

      // Assist ur "Player To Assist": en selektion per spelare, samma form som
      // Anytime Goalscorer ({label, over}).
      //
      // Forut lastes "Player To Score or Assist" och (Assist)-markta
      // selektioner plockades ut. Det gav noll traffar i 289 av 289 fall,
      // eftersom ingen av bockerna markte selektionerna sa. Och marknaden ar
      // fel verktyg: den ar P(mal ELLER assist), och att fa P(assist) ur den
      // kraver bade P(mal) och en antagen korrelation. "Player To Assist" ar
      // direkt det vi vill ha. Matt 2026-10-29: Paddy Power bjuder bada
      // marknaderna, Unibet ingen av dem.
      const assist = findMarket("Player To Assist");
      if (assist) {
        let traffar = 0;
        for (const sel of assist.odds) {
          const prob = impliedProb(sel.over);
          if (!prob) continue;
          const pid = matchPlayer(sel.label, fixtureTeams);
          if (pid) { stage(pid, "assistProb", prob); traffar++; }
        }
        // Marknaden finns men ingenting gick att lasa ur den: da ar det
        // formen eller etiketterna som inte stammer. Rått prov i samma svar.
        if (!traffar && assistSample === null)
          assistSample = { market: "Player To Assist", odds: (assist.odds || []).slice(0, 4) };
      }

      // Kalibrera bort marginalen, lagvis, mot lagets egen forvantade mal.
      // Forut gick den vagen om motstandarens clean sheet-odds; nu laser vi
      // lambda direkt ur lagtotalen, vilket ar ett steg kortare och samma tal.
      for (const teamId of fixtureTeams) {
        const lam = lambdaFor.get(teamId);
        const own = [...staged.values()].filter(e => e.team === teamId);
        const anytimes = own.map(e => e.anytimeProb).filter(Boolean);
        if (!anytimes.length) continue;
        if (lam == null) {
          // Utan lambda-ankare gar marginalen inte att mata, och da far
          // sannolikheterna inte skickas vidare.
          //
          // Forut lamnades de raa "och sades i svaret". Det var en tyst
          // fallback: coverage.uncalibratedTeams rapporterade saken, men
          // frontend laste aldrig faltet och matade in talen i xP anda.
          //
          // En ra 1/odds ar inte "nastan ratt" utan systematiskt uppblast.
          // Matt pa det cachade svaret 2026-10-29, 289 spelare: summan av
          // anytime-sannolikheterna lag over lagets forvantade mal for
          // SAMTLIGA 20 lag, median 1,64 ganger, Tottenham 3,24. Summan ar
          // vantevardet for antalet olika malskyttar och kan aldrig
          // overstiga forvantade mal. Uppblasta malsannolikheter flyttar
          // kaptensrankningen, sa botens egen xG-modell - som ar matt och
          // kalibrerad - ar battre an odds vi inte kan de-vigga.
          uncalibratedTeams.add(teamId);
          for (const pid of [...staged.keys()])
            if (staged.get(pid).team === teamId) staged.delete(pid);
          continue;
        }
        const alpha = calibrationExponent(anytimes, lam);
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
        gameweek: nextEvent.id,
        eventsInWindow: inWindow.length,
        teamsWithOdds: Object.keys(byTeam).length,
        bookmakers: [...marknaderPerBok.keys()],
        bookmakersRequested: BOOKMAKER_PARAM,
        rateLimit: kvot,
        marketsSeen: Object.fromEntries(
          [...marknaderPerBok].map(([bok, m]) => [bok, [...m].sort()])),
        teamTotalSample,
        assistSample,
        unmappedTeams: [...unmappedTeams],
        unmatchedLabels: { count: unmatched.size, sample: [...unmatched].slice(0, 25) },
        ambiguousLabels: { count: ambiguous.size, sample: [...ambiguous].slice(0, 25) },
        calibration,
        uncalibratedTeams: [...uncalibratedTeams],
      },
    };
    CACHE = { data: payload, ts: Date.now() };
    const fickOdds = Object.keys(byTeam).length > 0;
    res.setHeader("X-Odds-Cache", "miss");
    res.setHeader("X-Odds-Teams", String(Object.keys(byTeam).length));
    res.setHeader("Cache-Control", fickOdds ? CDN_CACHE : CDN_CACHE_TOMT);
    return res.status(200).json(payload);
  } catch (e) {
    // Ingen tyst fallback: säg tydligt att det gick fel, så artefakten
    // kan visa "odds ej tillgängligt" istället för att låtsas ha data.
    return res.status(502).json({ error: String(e.message || e) });
  }
}
