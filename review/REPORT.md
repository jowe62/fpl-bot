# GLENN/OS — granskning 2026-10-30

## Status

| | |
|---|---|
| **Klara** | **B1** (`430f2aa`), **B2** (`ee2defe`), **B3** (`1e40f35`), **B4** (`fb61d56`), **B5** (`ceb996b`), **B6** (`790692f`), **B7** (`a07a992`) |
| **Kvar** | B8, B9, B10, B11, B12, B13, B14, B15 |

Ordningen är Johns. Han plockar ID, ett i taget.

Utredningen är rapporten nedan. **Åtgärdade ID ändrar filer i appen** — B1, B2,
B3–B7 har alla rört `index.html`. Raden här påstod tidigare att inget ändrats;
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
| ~~B5~~ | Tillgänglighet | ~~Medel~~ **KLAR** `ceb996b` | `T.dim` och `T.disabled` klarar inte WCAG AA. **Mätningen hittade fyra fel till som rapporten missade — ett av dem allvarligt: skadekorten är vit text på vit platta.** | Mätt i DOM:en, alla tio flikar och båda lagen: varje textnod, dess verkliga bakgrund (alfa-komposterad uppåt), storlek och vikt, mot AA-tröskeln. **102 fall på Veckan ensam.** Rapportens siffror stämde exakt (dim 3,79:1 mot card, 4,33:1 mot bg; disabled 2,39:1). Nytt: (a) `InjuryTab` sätter en **opak** `#FAEFEC` som bakgrund i en mörk app — namnet låg på **1,03:1**, i praktiken osynligt; (b) `dim` på fixturebrickornas färgtoner, 2,81:1 vid 8,5 px i `pFxOpp` och 3,93:1 i `FixtureTicker` — filens värsta värden; (c) `POS_TINT[4]` (ANF) 4,44:1 vid 9 px. Rapportens egen fix `#7C8694` hade **inte räckt**: 4,23:1 mot `overlay`. | `dim`→`#818B98`, `disabled`→`#778396`, `dim`→`mut` på de två tonade brickorna, ANF→`#FF5C9A`, och `#FAEFEC`→ny `T.badBg`. | **Ja**, mätt i webbläsaren före och efter |
| ~~B6~~ | UX | ~~Medel~~ **KLAR** `790692f` | Deadline visades aldrig, trots att hela botens syfte är beslut före deadline. | `grep -c deadline_time index.html` → **0**; fältet läses bara i `api/odds.js`. Bekräftat mot **live** bootstrap 2026-10-30: `deadline_time_epoch` 1793444400 = `deadline_time` 2026-10-31T11:00:00Z, alltså GW9-deadline kl 12:00 svensk tid — 23½ timme bort och ingenstans i gränssnittet. | Nedräkning som nyckeltal intill NÄSTA OMGÅNG, plus den absoluta tidpunkten i huvudraden. | **Ja**, kört i webbläsaren: alla tre lägen plus tickandet |
| ~~B7~~ | Kod | ~~Medel~~ **KLAR** `a07a992` | `useEffect` för iframe-höjd saknade beroendelista och rev upp en `ResizeObserver` vid varje omrendering. **B6 gjorde den värre: churnen slutade bero på att någon klickar.** | Mätt i en **riktig iframe** (effekten returnerar tidigt på toppnivå, så den går inte att mäta där) med en räknare runt `ResizeObserver`. Före: fem flikbyten → **4 nya observers**, och 60 sekunders helt stillastående sida → **2 till**, alltså ~2 880 rivna observers per dygn på en orörd flik sedan `790692f`. Varje cykel skickade dessutom två hojdmeddelanden med **oförändrad** höjd. | `},[])`. Blocket stänger inte om någon state eller prop, så listan kan inte ge en inaktuell closure. | **Ja**, mätt i iframe före och efter |
| **B8** | Säkerhet | Medel | `/api/fpl` är en öppen proxy som vem som helst kan använda. | `api/fpl.js:3` sätter ihop `path` från query utan validering, och rad 10 sätter `Access-Control-Allow-Origin: *`. Värden är hårdkodad i strängen, så det går **inte** att nå en annan domän — men vem som helst kan använda kontots Vercel-funktion som gratis FPL-proxy. | Tillåt bara en lista av kända sökvägsmönster, och begränsa `ACAO` till den egna domänen. | **Ja**, läst. Att värden inte går att byta är verifierat genom att basen är en literal |
| **B9** | Kod | Låg | Död kod. | `PlayerChip` definieras på rad 1775 och förekommer ingen annanstans. `POS_SV` definieras på rad 194 och används aldrig. Båda verifierade med ordgräns-grep över hela filen. | Ta bort. | **Ja**, grep |
| **B10** | UX / språk | Låg | Uppräkningar blir "A och B och C" i stället för "A, B och C". | `index.html:2307` och `2313`: `.join(" och ")`. Syns i skärmbilden av Veckan: "Byt in Kinsky och N.Williams och McBurnie". | Hjälpfunktion som sätter komma mellan alla utom de två sista. | **Ja**, skärmbild + kod |
| **B11** | Modell | Låg | Triple Captain utesluter målvakter ur kaptensvalet. | `index.html:1181`: `starters.filter(p=>p.element_type!==1)`. FPL tillåter kapten på målvakt. Filtret är ett antagande, inte en regel läst ur API:t, vilket projektets egna regler säger att man inte ska göra. | Ta bort filtret. En målvakt vinner ändå aldrig i praktiken, så beteendet ändras inte — men antagandet försvinner. | **Ja**, läst |
| **B12** | UX | Låg | Chips-fliken räknar fram och visar ett värde för ett chip som är förbrukat. | Skärmbilden av Chips: Triple Captain visar "Ger 4.5 xP extra den här omgången" samtidigt som den är märkt SLUT och "använt i GW3". Koden sätter `available:false` (rad 1143) men renderar ändå värdet. | Visa inget värde när `available` är falskt. |  **Ja**, skärmbild + kod |
| **B13** | UX | Låg | Ranken läses som tre separata nyckeltal. | Skärmbilderna: "#3  136  725" står bredvid "£1.6m", "GW9", "1" med samma visuella avstånd, men bara den första har etiketten RANK under sig. **Min första teori var fel**: talet radbryter inte, `toLocaleString("sv-SE")` ger hårda mellanslag (U+00A0, verifierat). Problemet är att tusenavskiljarna i displayfonten ser lika breda ut som `gap:24px` mellan nyckeltalen (rad 1612). | Öka avståndet mellan nyckeltal, eller använd punkt som avskiljare i just det talet. | **Ja**, teorin om radbrytning motbevisad |
| **B14** | Kod | Låg | "av fyra bänkspelare" är hårdkodat. | `index.html:875`. Bänken är alltid fyra i FPL, så det stämmer idag. Det är en konstant som borde vara `r.benchNames.length`. | Härled talet. | **Ja**, läst |
| **B15** | Säkerhet | Låg | Felsvar från `/api/fpl` saknar CORS-header och läcker intern feltext. | `api/fpl.js:8` returnerar fel utan `ACAO`, rad 14 returnerar `e.message` rakt ut. | Sätt headern innan felsvaren och logga detaljen i stället för att returnera den. | **Ja**, läst |

---

## Funktionell verifiering per vy

| Vy | Påstår | Stämmer det? |
|---|---|---|
| Veckan | Kaptensråd, laguppställning, transfer, flaggor | Ja. Kaptensvärdet 4,5 xP reproducerat i riggen. Brist: vice saknas (**B2**), uppräkningar (**B10**) |
| Kapten | Rankning på xP-modell | Ja, ren argmax på `estimateXp`. Ingen vice-rankning (**B2**) |
| Byten | Femveckorsplan plus tre enskilda alternativ | Ja. Planen och alternativen räknar **olika** saker, vilket framgår av rubrikerna. Låsningen (**B4**) är åtgärdad |
| Fixtures | xP per omgång, färg relativt spelarens eget snitt | Ja, matchar riggen |
| Chips | Vad varje chip är värt | Bench Boost (**B1**) och Free Hits döda horisontvärde (**B3**) är åtgärdade. Kvar: förbrukade chip visar värde (**B12**) |
| Ligan | Serietabell räknad ur matchresultat | **Ja, exakt.** Oberoende uträknad: MCI 8-7-0-1, 20-9, 21 p. Botens påstående att FPL:s egen tabelldata är tom är verifierat: `played/win/draw/loss/points` är noll för alla 20 lag |
| Eliten | Effektivt ägande ur topp 50 | Formeln håller: Haaland 174 % = ägande plus kaptensandel, vilket är rätt definition |
| Facit | Jämför prognos mot utfall | Ja. Baslinjen finns med, vilket är rätt. Hårdkodad bänkstorlek (**B14**) |
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

## Vad som gjordes med B1–B7

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

Nedskriven begränsning: `(1 - xMins)` är inte sannolikheten att kaptenen spelar
noll minuter, eftersom xMins är en minutandel. Håller för etablerade
startspelare, vilket är de enda som väljs.

## Att ta ställning till

**B1 och B2 är de enda som flyttar ett beslut.** B1 får Bench Boost att se
bättre ut än det är, och B2 gör att kaptensvalet saknar en term som är värd
knappt en halv poäng och växer när kaptenen är osäker. Resten är hygien.

Vice kapten är dessutom uttryckligen önskad som funktion, så **B2 är både en
bugg och den funktionen** — de bör byggas i samma ändring.
