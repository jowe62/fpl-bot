# GLENN/OS — granskning 2026-10-30

## Status

| | |
|---|---|
| **Klara** | **B1** (`430f2aa`), **B2** (`ee2defe`), **B3** (`1e40f35`), **B4** (`fb61d56`), **B5** (`ceb996b`), **B6** (`790692f`), **B7** (`a07a992`), **B8** (`26fb616`), **B13** (`9baf325`), **B9** (`5627ae6`), **B10** (`af900cf`), **B11** (`eb1d11a`), **B12** (`00be5a2`), **B14** (`ddb4ffb`), **B15** (`8f69763`) |
| **Kvar** | — alla femton åtgärdade |

Ordningen var Johns. Han plockade ID, ett i taget. **Alla femton är åtgärdade.**

Utredningen är rapporten nedan. **Åtgärdade ID ändrar filer i appen** — B1, B2,
B3–B7 och B13 har rört `index.html`, B8 `api/fpl.js`. Raden här påstod tidigare att inget ändrats;
det var sant när rapporten skrevs och fel därefter.

**Om underlaget.** `/review/screens/` fanns inte på disk. Skärmbilderna kom i
meddelandet och har granskats därifrån: Veckan (smal), Kapten, Byten, Fixtures,
Chips, Ligan, Eliten, Facit, Analys, Skador.

**Metod.** Botens egna funktioner har körts utanför webbläsaren genom att
`index.html`:s babel-block laddas i en VM. Det är inte en kopia av modellen utan
modellen själv, så en mätning här kan inte driva isär från koden. Riggen är
validerad mot verkligheten: den ger Haaland 4,89 xP, den levande boten visar 4,9.

---

## Bygg, typkontroll, lint

Det finns inget av det. Ingen `package.json`, ingen `tsconfig.json`, ingen
eslint-konfiguration. Projektet är en enda HTML-fil som transpileras av
Babel-standalone i webbläsaren, plus sex serverlösa funktioner.

Vad som faktiskt går att köra:

| Kontroll | Utfall |
|---|---|
| JSX-kompilering med riktig Babel | OK, 3 764 rader in, 6 225 ut |
| `node --check` på alla sex `api/*.js` | OK |
| `eval/grounding.test.mjs` | Alla fall som väntat |

Konsekvensen är att hela klassen av fel som en typkontroll fångar — fel antal
argument, felstavade fält, `undefined` som smiter igenom — bara syns när koden
körs. **B4** nedan är ett exempel som en lint hade fångat direkt.

---

## Arkitektur

**Klient.** `index.html`, 3 882 rader, en enda fil. React via Babel-standalone,
inget byggsteg. 24 komponenter, 10 flikar (`TABS`, rad 3529).

All datainhämtning sker i **en** `useEffect` i `App` (rad 3572), som kör två
`Promise.all`-omgångar mot `/api/fpl`. Första: bootstrap och entry. Andra:
picks, fixtures, history, live, transfers. Allt läggs i ett enda `fplData`-objekt
och skickas ned som props. Ingen router, ingen global state, ingen datacache i
klienten utöver `localStorage`.

**Modellen** ligger på modulnivå i samma fil: `estimateXpAt` (rad 523) är navet,
med `xMins`, `attackPer90`, `cleanSheetProbAt`, `bpsPer90` under sig. `SEASON`
är ett muterbart modulobjekt som fylls vid uppstart.

**Server.** Sex funktioner i `/api`. `fpl.js` är en ren proxy. `odds.js` är den
tunga: hämtar odds, matchar namn mot FPL:s id, de-viggar och kalibrerar.
`briefing.js` anropar Anthropic. `news.js`, `league.js`, `elite.js` hämtar och
cachar.

**Cacheskikt.** Tre nivåer, lätta att blanda ihop: minnescache i lambdan
(töms vid kallstart), CDN-cache via `Cache-Control`, och `localStorage` i
webbläsaren (per enhet, per lag).

**Truppen.** FPL publicerar en omgångs trupp först efter deadline, så det
aktuella laget kan bara nås via `/api/my-team/` med användarens egen session.
Det sker genom en bokmärkesknapp som skickar nyttolasten i URL-fragmentet.
Fragmentet når aldrig en server.

---

## Prioriterad tabell

| ID | Område | Allvar | Problem | Bevis | Föreslagen fix | Verifierad? |
|---|---|---|---|---|---|---|
| ~~B1~~ | Bugg / modell | ~~Kritisk~~ **KLAR** `430f2aa` | Bench Boost överskattas med 40–96 %. Chipets värde sätts till hela bänkens xP, men utan chipet ger auto-bytena redan en stor del av den poängen när en startspelare uteblir. | `index.html:1178` `const bb=bench.reduce((s,p)=>s+xp(p),0)` med kommentaren "alltså exakt bänkens xP". Kört: frisk trupp bb 13,53 xP, förväntat antal uteblivna startspelare 1,40, bänkspelares xP när han spelar 3,82 → auto-byten värda ca 5,36 xP, alltså **40 %** av det chipet påstås ge. Med tre skadade i truppen: 96 %. Facit-fliken bekräftar att auto-byten faktiskt utlöses ("1 startspelare uteblev, så auto-bytena var i spel"). | Dra av auto-bytenas väntevärde: `bb = bänkens xP − Σ(1−xMins) över startelvan × villkorad bänk-xP`, med hänsyn till att målvakt bara ersätts av målvakt. | **Ja**, kört |
| ~~B2~~ | Modell / saknad funktion | ~~Hög~~ **KLAR** `ee2defe` | Vice kapten finns inte i någon uträkning. Modellen dubblar kaptenen utan att väga in att vice tar över om kaptenen inte spelar, och boten rekommenderar aldrig en vice. | `isVice` förekommer på exakt två ställen, `index.html:1734` och `1784`, båda rent visuella. Kaptensvärdet är `xi.total + kapten` utan vice-term. Kört: Haaland speltid 89 %, vices villkorade xP 4,59 → modellen missar ca **0,45 xP** och kan välja fel kapten när två kandidater ligger nära men har olika startsannolikhet. | Lägg till vice-termen i kaptensvärdet och ranka vice separat i Kapten-fliken. Gäller även Triple Captain, där vice ärver multiplikatorn. | **Ja**, kört |
| ~~B3~~ | Bugg / död kod | ~~Medel~~ **KLAR** `1e40f35` | Free Hits blankvärde räknades mot fel omgång och blev alltid 0 för `g===gw`. **Allvaret var dock överskattat: talet nådde aldrig användaren.** | `index.html:1297` värderade blanks med `estimateXpAt(p,fm,**gw**,false)` i en loop över `g`. En blank spelare saknar per definition match i sin egen omgång, så raden gav 0. Kört med syntetisk blank (Haalands lag utan match i GW9): summan 0,000 trots `estimateXpLong` 3,15 xP/omgång. **Men `fh` lästes aldrig** — `line("fh", …)` anropas inte (bara `line("bb")` och `line("tc")`), fh-kortet sätter `gain:null` och visar `now.blanks` i stället. Inget utanför `index.html` läser `fh` heller. | Ta bort den döda summan, behåll antalet. `freeHitGain` är den enda vägen till Free Hits värde. | **Ja**, kört före och efter |
| ~~B4~~ | Bugg / tillstånd | ~~Medel~~ **KLAR** `fb61d56` | Ett kast ur `buildRecs` hanterades inte. **Rapporten hittade ett av tre anropsställen, och inte det värsta: ett kast i `WeekTab` tar hela appen med sig — vit sida.** | Kört i webbläsaren mot en lokal kopia med ett injicerat kast i `buildRecs`. (a) `WeekTab:2214`, `useMemo` mitt i renderingen utan `try/catch` → **tom sida**, hela boten, felet bara i konsolen. (b) `App.runTransfers:3816`, `setAnalyzing(false)` efter anropet → knappen fast på "Analyserar..." med `disabled:true`, verifierat i DOM:en, kvar tills sidan laddas om. (c) `TransferPlan:2161` hade redan `try/catch` — mönstret var alltså inkonsekvent på tre ställen i samma fil. **Det går inte att utlösa idag:** grinden `harSaljpriser([...starters,...bench])` är exakt samma predikat som kastet på rad 1653, så säljpris-kastet är onåbart. Happy path verifierad: tre kort renderas, konsolen ren. | `try/catch` på alla tre ställena, `setAnalyzing(false)` i `finally`, och felet visas i UI:t. | **Ja**, kört i webbläsaren, före och efter |
| ~~B5~~ | Tillgänglighet | ~~Medel~~ **KLAR** `ceb996b` + komplettering | `T.dim` och `T.disabled` klarar inte WCAG AA. **Mätningen hittade fyra fel till som rapporten missade — ett av dem allvarligt: skadekorten är vit text på vit platta.** | Mätt i DOM:en, alla tio flikar och båda lagen: varje textnod, dess verkliga bakgrund (alfa-komposterad uppåt), storlek och vikt, mot AA-tröskeln. **102 fall på Veckan ensam.** Rapportens siffror stämde exakt (dim 3,79:1 mot card, 4,33:1 mot bg; disabled 2,39:1). Nytt: (a) `InjuryTab` sätter en **opak** `#FAEFEC` som bakgrund i en mörk app — namnet låg på **1,03:1**, i praktiken osynligt; (b) `dim` på fixturebrickornas färgtoner, 2,81:1 vid 8,5 px i `pFxOpp` och 3,93:1 i `FixtureTicker` — filens värsta värden; (c) `POS_TINT[4]` (ANF) 4,44:1 vid 9 px. Rapportens egen fix `#7C8694` hade **inte räckt**: 4,23:1 mot `overlay`. | `dim`→`#818B98`, `disabled`→`#778396`, `dim`→`mut` på de två tonade brickorna, ANF→`#FF5C9A`, och `#FAEFEC`→ny `T.badBg`. | **Ja**, mätt i webbläsaren före och efter — men första svepet var ofullständigt, se nedan |
| ~~B6~~ | UX | ~~Medel~~ **KLAR** `790692f` | Deadline visades aldrig, trots att hela botens syfte är beslut före deadline. | `grep -c deadline_time index.html` → **0**; fältet läses bara i `api/odds.js`. Bekräftat mot **live** bootstrap 2026-10-30: `deadline_time_epoch` 1793444400 = `deadline_time` 2026-10-31T11:00:00Z, alltså GW9-deadline kl 12:00 svensk tid — 23½ timme bort och ingenstans i gränssnittet. | Nedräkning som nyckeltal intill NÄSTA OMGÅNG, plus den absoluta tidpunkten i huvudraden. | **Ja**, kört i webbläsaren: alla tre lägen plus tickandet |
| ~~B7~~ | Kod | ~~Medel~~ **KLAR** `a07a992` | `useEffect` för iframe-höjd saknade beroendelista och rev upp en `ResizeObserver` vid varje omrendering. **B6 gjorde den värre: churnen slutade bero på att någon klickar.** | Mätt i en **riktig iframe** (effekten returnerar tidigt på toppnivå, så den går inte att mäta där) med en räknare runt `ResizeObserver`. Före: fem flikbyten → **4 nya observers**, och 60 sekunders helt stillastående sida → **2 till**, alltså ~2 880 rivna observers per dygn på en orörd flik sedan `790692f`. Varje cykel skickade dessutom två hojdmeddelanden med **oförändrad** höjd. | `},[])`. Blocket stänger inte om någon state eller prop, så listan kan inte ge en inaktuell closure. | **Ja**, mätt i iframe före och efter |
| ~~B8~~ | Säkerhet | ~~Medel~~ **KLAR** `26fb616` | `/api/fpl` var en öppen proxy som vem som helst kunde använda. | Bevisat mot **den skarpa deployen** 2026-10-30, inte bara läst: `/leagues-classic/314/standings/`, `/element-summary/411/`, `/event-status/` och `/entry/1/` gav alla **200** från min maskin — sökvägar boten aldrig efterfrågar. `ACAO: *` bekräftad i svaret. Att värden **inte** gick att byta prövades också i stället för att antas: tio försök (`//evil.example/x`, `https://evil.example/`, `@evil.example/`, `/../../..`, `..%2F`, backslash, tabb, fragment) gav alla host `fantasy.premierleague.com`, eftersom basen slutar på `/api` och allt som följer därmed är en sökväg. **Kvotmissbruk, inte SSRF.** | Vitlista med botens sju sökvägar; `ACAO` borttagen helt eftersom boten är samma origin. | **Ja**, kört: handlern mot alla vägar, plus hela boten genom den |
| ~~B9~~ | Kod | ~~Låg~~ **KLAR** `5627ae6` | Död kod. | Svepte hela babel-blocket i stället för att bara kontrollera de två rapporten nämnde: **150 deklarationer på toppnivå, 2 utan någon användning** — precis `PlayerChip` och `POS_SV`, så rapporten hade rätt och var uttömmande på den punkten. Samma svep över paletten hittade **fem oanvända fält**: `raised` och `overlay` (dubbletter av `card` respektive `line`, samma hexvärde), `neutral` (låst på gamla dim `#6C7684`, 3,79:1 — en fälla jag flaggade i B5), samt `brandHover`/`brandPress`. | Ta bort de två funktionerna och de tre dubblett-/fällefälten. `brandHover`/`brandPress` **behålls**: de har egna värden och en dokumenterad roll som interaktionslägen, till skillnad från dubbletterna. | **Ja**, svep + körd app före/efter |
| ~~B10~~ | UX / språk | ~~Låg~~ **KLAR** `af900cf` | Uppräkningar blir "A och B och C". | Reproducerat i webbläsaren, inte bara läst: med tre inbytta gav koden **"Byt in Kinsky och Guéhi och N.Williams"** och **"Bänka Raya och Gudmundsson och N.Williams."** — samma mönster som granskningens skärmbild. Varken Johns eller Richards trupp hade tre just nu, så läget tvingades fram i en serverad kopia. **Samma svep hittade motsatt fel:** `join(", ")` mitt i en mening gav "Bänken består av Kinsky, Shaw, Janelt, Szoboszlai." | Hjälpfunktion `lista()`; använd i de fyra meningarna, inte i datalistor. | **Ja**, kört vid 1–4 namn |
| ~~B11~~ | Modell | ~~Låg~~ **KLAR** `eb1d11a` | Triple Captain uteslöt målvakter ur kaptensvalet. **Och filtret satt på tre ställen, inte ett — medan ett fjärde redan saknade det.** | Regeln verifierad mot premierleague.com: *"You must also choose a captain and a vice-captain from the players in your line-up"* — ingen positionsbegränsning. `bootstrap.game_settings` bär **inget** kaptensfält alls, så det gick inte att läsa ur API:t; antagandet var alltså oundvikligt att upptäcka, men inte att behålla. `planGwVarde` anropade redan `armband(xi.xi, …)` **utan** filter, så modellen svarade olika beroende på vilken vy som frågade. | Ta bort filtret på alla tre ställena. | **Ja**, mätt på 50 riktiga trupper |
| ~~B12~~ | UX | ~~Låg~~ **KLAR** `00be5a2` | Chips-fliken visar ett värde för ett chip som är förbrukat. | Reproducerat i UI:t: Triple Captain visade **"SLUT · använt i GW3"** och direkt under **"Ger 5.2 xP extra den här omgången"** plus raden om vilken av de fem kommande omgångarna som vore bäst — råd om ett drag som inte finns. `chipAvailability` bekräftar mot live-data: `tc available=false, usedAt=3`. **Samma kort hade ett andra fel:** etiketten var hårdkodad "SLUT" för *all* otillgänglighet. I GW1 ligger både wildcard och Free Hit utanför sina fönster (båda börjar GW2) — då hade kortet påstått att de var förbrukade innan säsongen börjat. | Rendera varken värde eller jämförelse när chipet inte går att spela, och skilj "SLUT" från "STÄNGT". | **Ja**, båda lägena körda i webbläsaren |
| ~~B13~~ | UX | ~~Låg~~ **KLAR** `9baf325` | Ranken läses som tre separata nyckeltal. | Uppmätt i DOM:en med `Range.getBoundingClientRect`, tecken för tecken: IBM Plex Mono är monospace, så **varje** glyf vid 40 px är 23,20 px bred — inklusive U+00A0. Avståndet mellan två **skilda** nyckeltal är 24 px. **Skillnad 0,79 px.** Rapportens korrigering stämde: talet radbryter inte, separatorerna är hårda mellanslag (teckenkod 160 avläst). Samma mätning visade att **`23t 3m`, nyckeltalet från B6, hade exakt samma fel** (23,21 px). | U+2009 i stället för U+00A0 i båda. | **Ja**, mätt före och efter, desktop och mobil |
| ~~B14~~ | Kod | ~~Låg~~ **KLAR** `ddb4ffb` | "av fyra bänkspelare" är hårdkodat. **Och det fanns ett till: "av dina 11" i template-raden.** | Meningen räknar själv ur `r.benchNames` och sätter sedan "fyra" som text — två källor för samma tal, där den ena tyst slutar stämma om FPL ändrar sig. Samma sak på Veckan: `overlap` räknas ur `starters` men nämnaren stod som "11". Filen har redan `squadRules(bs)` som läser `squad_squadsize` ur bootstrap och kastar om den saknas, och HANDOFF säger uttryckligen "lägg inte tillbaka någon av dem som konstant". | `r.benchNames.length` respektive `starters.length`. | **Ja**, kört med 3, 4 och 6 på bänken |
| ~~B15~~ | Säkerhet | ~~Låg~~ **KLAR** `8f69763` | Felsvar saknar CORS-header och läcker intern feltext. | **CORS-delen är redan löst och på ett annat sätt än rapporten tänkte:** `B8` tog bort `ACAO` från *alla* svar, eftersom boten är samma origin. Felsvaren är alltså konsekventa med resten — inget att lägga till. Läckan var verklig och mättes med stubbad `fetch` mot den riktiga handlern: DNS-fel gav `getaddrinfo ENOTFOUND fantasy.premierleague.com`, och när FPL svarar HTML i stället för JSON gick **ett stycke av deras svarsbody** rakt igenom. Samtidigt loggades **ingenting** — den som driver tjänsten såg minst av alla. | Logga detaljen med sökvägen, returnera `Upstream request failed`. | **Ja**, fyra felvägar körda före och efter |

---

## Funktionell verifiering per vy

| Vy | Påstår | Stämmer det? |
|---|---|---|
| Veckan | Kaptensråd, laguppställning, transfer, flaggor | Ja. Kaptensvärdet 4,5 xP reproducerat i riggen. Vice (**B2**) och uppräkningarna (**B10**) är åtgärdade |
| Kapten | Rankning på xP-modell | Ja. Vice ingår sedan **B2**, och hela elvan rankas sedan **B11** |
| Byten | Femveckorsplan plus tre enskilda alternativ | Ja. Planen och alternativen räknar **olika** saker, vilket framgår av rubrikerna. Låsningen (**B4**) är åtgärdad |
| Fixtures | xP per omgång, färg relativt spelarens eget snitt | Ja, matchar riggen |
| Chips | Vad varje chip är värt | **Ja**, efter **B1**, **B3** och **B12**. Förbrukade och stängda chip visar inget värde |
| Ligan | Serietabell räknad ur matchresultat | **Ja, exakt.** Oberoende uträknad: MCI 8-7-0-1, 20-9, 21 p. Botens påstående att FPL:s egen tabelldata är tom är verifierat: `played/win/draw/loss/points` är noll för alla 20 lag |
| Eliten | Effektivt ägande ur topp 50 | Formeln håller: Haaland 174 % = ägande plus kaptensandel, vilket är rätt definition |
| Facit | Jämför prognos mot utfall | **Ja**. Baslinjen finns med, vilket är rätt, och bänkstorleken härleds sedan **B14** |
| Analys | Poänguppdelning och xP-kurvor | Ja |
| Skador | Flaggade spelare | **Rättad observation:** fliken var inte tom. Raderna renderades med `T.ink` på en opak nästan-vit platta — 1,03:1, alltså osynliga (**B5**). Nu läsbara: tre skadade visas. Att Veckan har en egen nyhetspanel står kvar — två ställen för samma sak |

---

## Noterat, inte buggar

- **Felhanteringen är genomgående bra.** `fplFetch` kastar med status och sökväg,
  `App` har riktiga lägen för laddning och fel, och felvyn skiljer 403 från
  övrigt. Det är ovanligt gjort.
- **Inga tysta reserver i datavägarna.** Saknas säljpriser räknas ingenting, och
  gränssnittet säger varför. Odds som inte går att de-vigga slopas i stället för
  att skickas vidare råa. Det följer projektets egen regel.
- **Modellen mäts mot en baslinje** i Facit-fliken, vilket är rätt sätt.

## Vad som gjordes med B1–B15

**B1, `430f2aa`.** Bench Boost dras nu med auto-bytenas väntevärde.
`vinst_k = xP_k * (1 - P(N >= k))` där N är antalet uteblivna startande
utespelare, Poisson-binomialfördelat. Målvaktsplatsen är en egen kö. Nya
funktioner: `antalUteblivna`, `benchBoostGain`. Effekt: frisk trupp 13,53 →
8,76 xP. **Chiprådet ändrades** — Bench Boost låg över Triple Captain, ligger
nu under. Verifierat mot ren uppräkning av 2^10 utfall och sju ytterlägen.

**B2, `ee2defe`.** Ny funktion `armband(kandidater, xpOf)` som väljer kapten och
vice ihop: `xP(K) + (1-speltid(K)) * xP(V)`, uttömmande över alla par. Används i
`planGwVarde`, Triple Captain, WeekTab och CaptainTab. Briefen fick
`viceKaptenNamn` plus en ordlisterad i `api/briefing.js`. Effekt: +0,45 xP på
Johns trupp. **Bandet flyttas inte** — på 20 riktiga trupper valdes alltid samma
kapten som en ren xP-sortering.

**B3, `1e40f35`.** Den döda `fh`-summan i `chipGainsOverHorizon` är borta; raden bär nu
bara `blanks` (antalet). Den oanvända `nollText`-parametern i `line()` och en
kommentar som påstod att Free Hit passerar där togs bort i samma ändring.
**Ingenting i UI:t ändras** — samma fyra chipkort, samma rubriker och samma
siffror före och efter, verifierat genom att köra `buildChipAdvice` i båda
lägena. Det var alltså hygien, inte en felaktig siffra för John.

Två fynd på vägen: det finns **inga riktiga blanka omgångar i GW9–38** (alla 20
lag har match varje omgång, mätt 2026-10-30), så blanks går bara att testa med
en syntetisk blank. Och `bb` visar 0,00 på Johns trupp av en riktig orsak, inte
en bugg: hela bänken — João Pedro, Shaw, Szoboszlai — har
`chance_of_playing_next_round: 0`, så `xMins` är 0 och bänken är värd noll.

**B4, `fb61d56`.** Alla tre anroparna av `buildRecs` hanterar nu ett kast. `runTransfers`
har `try/catch` med `setAnalyzing(false)` i `finally` och visar felet i
`c.errNote`; `WeekTab` fångar och **bär felet vidare** i stället för att svälja
det. Det sista är avsiktligt: ett tomt `recs` hade gjort `best` till null och
Veckan hade sagt "Gör ingen transfer" — ett självsäkert råd ingen räknat fram —
och briefen hade fått `gorIngenTransfer: true`. Nu säger vyn "Kan inte räkna på
byten" med felet, och briefen får `transfer: null`.

Allt verifierat **i webbläsaren** mot en lokal kopia med ett injicerat kast:
före fixen tom sida respektive låst knapp, efter fixen renderad sida med
felmeddelande och en knapp som går att trycka igen. Återhämtning testad — nästa
lyckade klick rensar felet och visar de tre korten.

Värt att notera: **felet går inte att utlösa idag.** Grinden i UI:t är exakt
samma predikat som kastet i `buildRecs`, så säljpris-vägen är onåbar. Det som
fixats är att ett *framtida* kast inte längre släcker boten.

**B5, `ceb996b`.** Fem färger flyttade, alla med en uppmätt siffra bakom sig.
`T.dim` #6C7684→#818B98 (klarar 4,5:1 mot alla fyra ytorna, sämst 4,52 mot
`overlay`), `T.disabled` #4E5765→#778396 (2,39→4,54), `POS_TINT[4]`
#FF2E7E→#FF5C9A (4,44→5,15), ny `T.badBg` i stället för den opaka `#FAEFEC`,
och `dim`→`mut` på de två ställen där texten ligger på en tonad bricka i
stället för en platt yta.

**Metoden var mätning, inte läsning.** Ett skript i sidan går igenom varje
textnod, komposterar fram den verkliga bakgrunden genom alfa-lagren och
jämför mot AA-tröskeln för nodens egen storlek och vikt. Det var så de fyra
extra felen hittades — ingen av dem syns i koden utan att man räknar.

**Före:** 102 fall på Veckan, 13 på Fixtures, 4 på Skador. **Efter: 0 på
samtliga tio flikar, för båda lagen** (Johns med säljpriser, Richards utan).
Avstängda knappen mätt separat under sitt 400 ms-fönster: 4,54:1.

**Första svepet var ofullständigt, och det upptäcktes under B9.** Det läste
bara textnoder och kördes bara i ett fönster. Två hela klasser gick förbi:

- **Hårdkodade färger i `<style>`-blocket.** CSS-blocket ser inte paletten, så
  tre `#6C7684` stod kvar som literaler i mobilreglerna.
- **Pseudoelement.** `::before` med `content:attr(data-l)` bär synlig text som
  ingen textnodsgenomgång hittar.

Båda syns bara vid mobilbredd. Uppmätt: **281 fall** — 141 på Fixtures, 140 på
Ligan, alla 4,33:1 på 9 och 11 px. Åtgärdat; svepet läser nu även
pseudoelement och kördes vid både 375 px och 1280 px: **0 fall på alla tio
flikarna vid båda bredderna.**

Lärdomen, nedskriven: ett kontrastsvep måste köras i minst två fönsterbredder
och måste läsa `::before`/`::after`. Annars mäter man bara halva appen.

En regel föll ut av arbetet och står nu i HANDOFF.md: **`dim` gäller platta
ytor. Ligger texten på en färgton är `mut` den enda tillåtna tonen.**

Noterat men inte ändrat: `T.neutral` står kvar på gamla `#6C7684` och är
**oanvänd** (0 träffar). Den hör till **B9**, men är en fälla — används den
någonsin återinförs felet.

**B6, `790692f`.** Nyckeltalsraden har fått **Till deadline** med en nedräkning, och
huvudraden den absoluta tidpunkten (`John Wennerqvist · GW9 · deadline lör
31 okt. 12:00`). Värdet läses ur `deadline_time_epoch`, som bekräftats mot
live bootstrap — inte antagits.

Tre lägen, alla körda i webbläsaren mot en kopia där deadline går att skjuta:
normalt (`23t 28m`), **brådska** under tre timmar (`1t 34m` i `T.warn`,
avläst `rgb(255,174,51)`) och **passerad** (`Passerad`, etiketten byter till
`DEADLINE`). Att passerad är ett eget läge är inte pynt: FPL låter `is_next`
peka på omgången en stund efter att den stängt, och då ska siffran säga det i
stället för att visa minus.

Saknas fältet blir det `–` / `DEADLINE SAKNAS` och huvudraden utelämnar
tidpunkten — samma linje som säljvärdet bredvid redan höll, alltså synligt
och inte tyst.

**Nedräkningen räknar faktiskt ned**, vilket mättes i stället för att antas:
`23t 30m → 23t 29m → 23t 28m` över 90 sekunder. Ticken är 30 s. Den kostnaden
kontrollerades också: `buildChipAdvice` är det enda tunga som körs omemoiserat
i en renderingsväg, och det tar **4,2 ms**. Elva gränsfall i `tidTill` körda
separat, från tre dygn ned till passerad.

Kontrastsvepet från **B5** kördes om efteråt: fortfarande 0 fall på alla tio
flikarna.

**B7, `a07a992`.** `},[])` — en rad. Arbetet låg i att mäta, inte i att ändra.

Effekten går inte att mäta på toppnivå: första raden är
`if(window.parent===window) return;`, så den gör ingenting när boten är öppen
direkt. Mätningen krävde en riktig föräldersida med en iframe, samma upplägg
som wennerqvist.design, plus en räknare runt `ResizeObserver`.

| | observers vid 5 flikbyten | observers vid 60 s stillastående |
|---|---|---|
| före | 4 | 2 |
| efter | **0** | **0** |

Totalt skapas nu **en** observer, och noll rivs.

**B6 gjorde B7 värre, och det är värt att säga rakt ut.** Före `790692f`
churnade effekten bara när något renderade om, alltså vid klick. Nedräkningens
tick på 30 s renderar om `App` oavsett vad användaren gör, så en orörd flik
rev ~2 880 observers per dygn.

**Risken med `[]` kontrollerades, inte antogs:** en tom lista kan ge en
inaktuell closure, och en observer som skapas en gång kan vara död. Blocket
stänger inte om någon state eller prop. Och efter fixen gav en verklig
storleksändring av iframen fyra nya höjdmeddelanden med fortfarande bara en
observer — den lever.

**B8, `26fb616`.** `api/fpl.js` har en vitlista med exakt de sju sökvägar boten
begär, och inget mer. Allt annat ger 400 innan något anrop görs mot FPL.

**`Access-Control-Allow-Origin` är borttagen, inte omskriven.** Rapporten
föreslog att begränsa den till egen domän, men boten hämtar `/api/fpl`
relativt och ligger alltså på samma origin som funktionen — även inne i
iframen på wennerqvist.design, vars dokument är vercel-adressen. Samma origin
frågar aldrig efter CORS, så headern fyllde ingen funktion för boten och
öppnade den bara för alla andra. Inget i repot anropar vägen från en annan
domän; skulle något utanför göra det slutar det fungera högljutt.

Kört mot den riktiga handlern: **7 av 7** av botens vägar ger 200 med äkta
FPL-data, **16 av 16** andra nekas (bland dem de fyra som bevisligen gick
igenom mot skarpa deployen), och fyra kantfall på själva parametern nekas —
inklusive `?path=a&path=b`, som Vercel ger som en array och där det vore en
tyst gissning att plocka första.

Sedan hela boten genom den: sidan laddar, **9 släppta och 0 nekade** av
botens egna anrop (de 7 vid laddning plus två egna stickprov), alla tio
flikar klickade utan ett enda extra anrop, konsolen ren.

**Sidofynd, inte åtgärdat:** koden sätter `Cache-Control: s-maxage=60`, men
skarpa deployen svarar `public, max-age=0, must-revalidate` med
`x-vercel-cache: MISS`. CDN-cachen som HANDOFF beskriver sker alltså inte på
den här endpointen. Orsaken är inte utredd — det kräver en deploy att pröva.
Noterat i HANDOFF.md som öppen tråd.

**B15 ligger kvar i samma fil** och rörs inte här: felsvaren saknar fortfarande
CORS-header (nu konsekvent, eftersom ingen sätts) och returnerar `e.message`.

**B13, `9baf325`.** Orsaken är mätt, inte gissad: i en monospace är mellanslaget lika
brett som en siffra, och `gap` mellan nyckeltalen råkar vara samma tal.

| | separator i talet | gap mellan nyckeltal | kvot |
|---|---|---|---|
| före, desktop | 23,20 px | 24 px | **1,03** |
| efter, desktop | 7,20 px | 24 px | **3,33** |
| efter, mobil | 4,33 px | 24 px | **5,54** |

Radantalet är oförändrat, 2 på desktop och 3 vid 375 px.

**Provat och förkastat: att öka `gap` i stället.** Mätt vid fyra värden — för
att nå samma tydlighet krävdes 48 px, och då blev mobilraden fyra rader i
stället för tre. 32 px, det största steget designsystemet tillåter mellan
ytor, gav bara 1,38 gånger separatorn. Den smalare separatorn kostar ingen
layout alls och skalar med fontstorleken av sig själv.

**Och mätningen fångade ett fel jag själv infört två ID tidigare:** `23t 3m`
från **B6** hade samma 23,21 px mellanrum. Rättat i samma ändring — det hade
varit ologiskt att laga ranken och lämna en identisk tvetydighet bredvid.

**B9, `5627ae6`.** Rapportens två fynd stämde, och svepet visade att de var de enda
funktionerna: 150 deklarationer på toppnivå, 2 oanvända. Men svepet över
paletten hittade mer — `raised` och `overlay` är rena dubbletter (samma
hexvärde som `card` och `line`) och `neutral` satt kvar på gamla dim-värdet
som inte klarar AA. Alla tre borta.

`brandHover` och `brandPress` är också oanvända men **behålls**. De har egna
värden och en dokumenterad roll — hover ljusare, press mörkare än
viloläget — till skillnad från dubbletterna. Gränsen jag dragit: ta bort
alias och fällor, behåll distinkta tokens som bär en designbeslut.

Efter borttagningen: 0 oanvända deklarationer, alla tio flikar renderar,
konsolen ren.

**Svepet missade två saker, hittade i efterhand.** Deklarationer *inne i*
komponenter och nycklar i stilobjektet `c` ligger inte på toppnivå. Där satt
`riskBg` i `TransferCard`: en färg per risknivå som skickades till `c.rb`,
vars hela kropp var `(bg)=>({})` — argumentet togs emot och kastades bort.
Riktningen bars hela tiden av textfärgen i `c.rv`. En av de bortkastade
färgerna var samma opaka `#FAEFEC` som gjorde skadekorten oläsliga i B5; här
målades den aldrig, men den låg och väntade. `riskBg`, `c.rb` och hela
bg-argumentet är borta. Korten renderar oförändrat, verifierat med alla tre
korten framme.

**Rättelse till B5:** motiveringen där åberopade `overlay` som "den ljusaste
ytan och därmed den svåraste". `T.overlay` målas aldrig — den var en oanvänd
dubblett. Den svåraste ytan som faktiskt förekommer är `card`, där `dim` ger
**5,05:1**. Valet av `#818B98` står kvar och har alltså mer marginal än jag
skrev, men skälet var fel och är rättat i HANDOFF.md.

**B10, `af900cf`.** `lista()` sätter komma mellan alla utom de två sista och "och"
före det sista — svenska har inget oxfordkomma.

Kört genom den riktiga vyn vid varje längd:

| antal | före | efter |
|---|---|---|
| 1 | Kinsky | Kinsky |
| 2 | Kinsky och Janelt | Kinsky och Janelt |
| 3 | Kinsky **och** Guéhi **och** N.Williams | Kinsky**,** Guéhi **och** N.Williams |
| 4 | … och … och … och … | Kinsky, Guéhi, N.Williams **och** De Cuyper |

**Felet fanns åt två håll.** `join(" och ")` gav "A och B och C"; `join(", ")`
mitt i en mening gav "Bänken består av A, B, C, D." Båda rättade, fyra
meningar totalt: inbytta, bänkade, bänkens sammansättning och "spelade inte
en minut" i Facit.

**Datalistor lämnas i fred** — `GW9 ARS · GW10 HUL`, `Utan odds, körs på xG:
BHA, FUL`, nyhetsraden och Eliten-listan är uppställningar, inte meningar, och
har sin egen avskiljare. Den gränsen står i koden.

**B11, `eb1d11a`.** Filtret `element_type!==1` satt i Triple Captain, WeekTab och
CaptainTab — men **inte** i `planGwVarde`, som planeraren använder. Fyra
anropsställen, två olika regler. Nu har alla fyra samma.

Regeln är läst ur källan, inte minnet: premierleague.com säger *"choose a
captain and a vice-captain from the players in your line-up"*, utan
positionskrav. `bootstrap.game_settings` innehåller inget kaptensfält, så
API:t kunde inte avgöra saken — vilket är precis varför antagandet smugit in.

**Mätt på 50 trupper ur topp 50 i totalligan:**

| | |
|---|---|
| kaptensvalet ändras | **0 av 50** |
| målvakt vald till kapten | 0 |
| målvakt vald till vice | 0 |
| största skillnad i väntevärde | **0,0000 xP** |

Bästa målvakt i hela ligan ligger 1,59 xP under bästa utespelare, så
marginalen är inte knapp.

**En synlig följd finns dock, och rapporten nämnde den inte:** Kapten-flikens
topp fem rankar nu hela elvan. I riggens körning tog målvakten femteplatsen i
7 av 50 trupper. I den levande appen, med aktuella odds, gör han det inte för
Johns trupp — listan är oförändrad där. Det är rätt beteende: fliken säger
"rankad på xP-modell", och då ska den visa vad modellen säger.

Triple Captain-värdet och bandet är oförändrade: Haaland/Rogers, samma siffra
före och efter.

**B12, `00be5a2`.** Kortet visar inget värde och ingen omgångsjämförelse för ett
chip du inte kan spela. Siffran räknas fortfarande — samma kod bygger alla
fyra korten — den påstås bara inte.

**Ett andra fel i samma kort:** etiketten var hårdkodad `SLUT` för all
otillgänglighet. Mätt mot live-data: i GW1 ligger både wildcard och Free Hit
utanför sina fönster (de är GW2–19 och GW20–38), så kortet hade sagt att de
var förbrukade innan säsongen ens börjat. Nu skiljer `usedAt != null` spelat
(`SLUT`) från stängt (`STÄNGT`).

Båda lägena körda i webbläsaren:

| läge | före | efter |
|---|---|---|
| TC spelat i GW3 | SLUT · använt i GW3 · **Ger 5.2 xP extra** · jämförelse | SLUT · använt i GW3 |
| WC utanför fönster | **SLUT** · utanför chipfönstret · förklaring | **STÄNGT** · utanför chipfönstret |

De tre spelbara korten är oförändrade, verifierat i samma körning.

**B14, `ddb4ffb`.** Två tal, inte ett. Facit sa "av fyra bänkspelare" och Veckan "av
dina 11" — båda i meningar som räknar täljaren ur datan men hade nämnaren
som text.

Att talen är härledda och inte råkar bli rätt är prövat genom att köra
`buildTakeaways` med olika bänkstorlek:

| bänk | före | efter |
|---|---|---|
| 4, tre nollor | 3 av **fyra** | 3 av **4** |
| 3, två nollor | 2 av **fyra** ← fel | 2 av **3** |
| 6, fem nollor | 5 av **fyra** ← fel | 5 av **6** |

I appen är siffrorna oförändrade — "3 av 4 bänkspelare gav noll" och "6 av
dina 11" — vilket är poängen: beteendet är detsamma, antagandet borta.

**Kvar, inte åtgärdat:** `validateLiveSquad` kastar på `d.picks.length!==15`
med texten "förväntade 15 spelare". Det är samma klass av konstant, men till
skillnad från de två ovan är det en **validering** — går den fel laddas ingen
trupp alls. `squadRules(bs)` har redan `squad_squadsize`, så den går att
härleda, men funktionen får inte `bs` idag. Värt en egen ändring, inte en
gratis följd av den här.

**B15, `8f69763`.** Felsvaren bär inte längre `e.message`.

**Rapportens CORS-del var redan avklarad, men inte som den trodde.** Den
föreslog att sätta headern *före* felsvaren. B8 tog i stället bort `ACAO`
helt, eftersom boten hämtar `/api/fpl` relativt och är samma origin. Felsvaren
är därmed konsekventa med alla andra svar, och det fanns inget att lägga till.

Läckan mättes med stubbad `fetch` mot den riktiga handlern:

| felväg | före | efter |
|---|---|---|
| DNS-fel | `getaddrinfo ENOTFOUND fantasy.premierleague.com` | `Upstream request failed` |
| nätverk nere | `fetch failed` | `Upstream request failed` |
| FPL svarar HTML | `Unexpected token < … "<!DOCTYPE html><html>…"` | `Upstream request failed` |
| FPL 403 | `FPL error` (403) | oförändrat |

Den tredje raden är den som betyder något: **upstreams svarsbody gick rakt
igenom till den som anropade.** Och i alla tre fallen loggades ingenting, så
den som driver tjänsten såg minst av alla. Nu är det tvärtom — detaljen går
till loggen med sökvägen som sammanhang.

Klienten tappar inget på bytet: `fplFetch` läser aldrig felkroppen, den kastar
på `HTTP ${status}`.

Nedskriven begränsning: `(1 - xMins)` är inte sannolikheten att kaptenen spelar
noll minuter, eftersom xMins är en minutandel. Håller för etablerade
startspelare, vilket är de enda som väljs.

## Att ta ställning till

**B1 och B2 är de enda som flyttar ett beslut.** B1 får Bench Boost att se
bättre ut än det är, och B2 gör att kaptensvalet saknar en term som är värd
knappt en halv poäng och växer när kaptenen är osäker. Resten är hygien.

Vice kapten är dessutom uttryckligen önskad som funktion, så **B2 är både en
bugg och den funktionen** — de bör byggas i samma ändring.
