# FPL-bot — överlämning

## Vad det är
En Fantasy Premier League-rådgivare (frontend, React via Babel i en enda HTML-fil)
som hämtar användarens lag + ligadata och ger förslag på kapten, byten, chips m.m.
Byggd på en egen xP-modell (expected points) plus riktiga bookmaker-odds.

Team-ID: 1036486 (hårdkodat i `TEAM_ID` överst i HTML:en).

## Fynd att återanvända

Allt som uppmäts eller läses ur en extern källa och kan behövas igen skrivs
ned här eller i rätt fackavsnitt nedan, **direkt när det upptäcks**. Annars
görs samma arbete om. Det har redan hänt: att gratisplanen inte ger Bet365
lästes ur ett felmeddelande, stod ingenstans, och oddsmodellen låg nere i
dagar medan vi gissade på namnmatchning.

Ett fynd är återanvändbart om det är **ett påstående om världen utanför
koden** — ett API:s kontrakt, en kvot, ett fältnamn, ett mätresultat, eller
en idé som provades och inte höll. Ett negativt resultat är lika mycket värt
som ett positivt: det hindrar nästa försök. Skriv alltid med **datum och hur
det mättes**, så det går att se när siffran blivit gammal.

Gratis felsökning som inte kostar kvot (börja alltid här):

| Vad | Hur | Kostar |
|---|---|---|
| Heter marknaden rätt? | `api.odds-api.io/v3/markets?sport=football` | 0, ingen nyckel |
| Är bokmakaren uppe? | `api.odds-api.io/v3/bookmakers` → `status`/`reason` | 0, ingen nyckel |
| Finns FPL-fältet? | `fantasy.premierleague.com/api/bootstrap-static/` | 0 |
| Vad svarade boten sist? | `fpl-bot-lovat.vercel.app/api/odds` vid CDN-träff | 0 uppströms |
| Funkar ändringen? | stubbad uppström i en lokal harness | 0 |

### Kör boten i en riktig webbläsare

Modellriggen nedan når inte UI-tillstånd — knappar, laddlägen, felvyer. Det
gör en lokal server: en `http.createServer` som serverar `index.html` och
proxar `/api/fpl?path=…` vidare till `fantasy.premierleague.com` (och övriga
`/api/*` till den live-deployade boten). Då kör man den **riktiga** filen med
**riktig** data.

Två saker som kostade tid att komma på:

1. **Byten-fliken kräver säljpriser**, som bara finns via bokmärkesknappen.
   Knappen "Visa mina alternativ" renderas inte alls utan dem. Lösning: bygg
   samma nyttolast som bokmärket och lägg den i URL-fragmentet —
   `#team=<base64 av JSON>`, där JSON:en är `{entry, gw, bank, picks:[{element,
   position, is_captain, is_vice_captain, selling_price}×15], raw:{…}}`.
   `entry` måste finnas i `TEAMS`, annars kastar `validateLiveSquad`.
   Base64:en avkodas som `decodeURIComponent(escape(atob(x)))`, så koda UTF-8-
   byten: `Buffer.from(json,"utf8").toString("base64")`.
2. **Felvägar testas med injicerat fel.** Servera en kopia av `index.html` där
   en funktion kastar bakom en flagga — `if(window.__fault) throw …` — ladda
   sidan, sätt `window.__fault=true` från konsolen, och utlös sedan just den
   väg du vill pröva. Utan flaggan kastar den under första renderingen och du
   ser bara den första kraschen, inte den du var ute efter.

Kom ihåg: `localStorage` är per origin, så en ny port har ingen sparad trupp.
Fragmentet måste med varje gång.

### Kör botens egen modell utanför webbläsaren

**Det finns inget byggsteg, ingen typkontroll och ingen lint.** Ingen
`package.json`, ingen `tsconfig`, ingen eslint. Hela klassen av fel som en
typkontroll fångar syns bara när koden körs. Det enda som går att köra:

| Kontroll | Kommando |
|---|---|
| JSX kompilerar | transpilera babel-blocket med riktig `@babel/standalone` |
| API-syntax | `node --check api/*.js` |
| Grounding | `node eval/grounding.test.mjs` |

Allt annat måste verifieras genom att **köra modellen**. Och då ska man köra
*botens* modell, inte en kopia av den — en kopia driver isar från koden direkt,
och då mäter man på fel sak.

Så här gör man (mönstret låg i `scratchpad/load.mjs`, och **scratchpad töms
mellan dagar** så det måste byggas om):

1. Läs ut `<script type="text/babel">...</script>` ur `index.html`.
2. Transpilera med `@babel/standalone` (`presets:["react"]`). Hämta den från
   cdn till en lokal fil en gång.
3. Kör resultatet i en `node:vm`-context med stubbade `React`, `ReactDOM`,
   `document`, `localStorage`, `location` och `fetch`. Funktionsdeklarationer
   hamnar då på context-objektet och går att anropa direkt.
4. `const` hamnar **inte** där — react-presetet rör inte deklarationstypen.
   Lägg till en epilog som exporterar dem:
   `;globalThis.__exp={SEASON, ODDS, T, c, SP, ...};`
   Låt en saknad nyckel braka högt i stället för att bli tyst `undefined`.
5. Sätt upp världen i samma ordning som `App` gör: `SEASON.gamesPlayed`,
   `buildTeamXgc`, `buildXgiPrior`, `nextGw`, fixture-kartan `fm`,
   `ODDS.byTeam`/`byPlayer`, sedan `calibrateBonusScale` och
   `calibrateAttackScale`.
6. **Validera riggen mot verkligheten innan du mäter något med den.** Jämför ett
   tal mot vad den levande boten visar. Riggen gav Haaland 4,89 xP och boten
   visade 4,9 — först då var den användbar.

Komponenter går att rendera rakt av: `ctx.CaptainTab({...props})` kör hela
kroppen inklusive JSX, så ett renderingsfel syns lokalt i stället för hos
användaren. `useMemo` i stubben ska vara `f=>f()`.

Fallgrop som kostade tid: `xMins` kan **aldrig** returnera 1,0. Den krymper mot
0,5 med två pseudo-omgångar, så taket efter åtta omgångar är 0,90. Ett test som
antar full speltid genom att sätta `minutes` högt misslyckas av fel skäl —
stubba `ctx.xMins` i stället när du vill prova ytterlägen.

Se också "Vad som är mätt, och vad som inte är det" samt "Kända fallgropar".

## Live nu
- **Bot:** fpl-bot-lovat.vercel.app (Vercel-projekt `fpl-bot`, GitHub-repo jowe62/fpl-bot)
- **Publik sida:** wennerqvist.design/fpl — en Webflow-sida med en `<iframe>`
  som pekar på vercel-adressen ovan. Webflow måste **publiceras** för att ändringar
  ska synas; iframen behöver ingen ändring när boten uppdateras (den laddar Vercel live).

## Repo-struktur (jowe62/fpl-bot)
```
index.html        ← hela boten (React/Babel, en fil, inget byggsteg)
api/fpl.js        ← proxy mot fantasy.premierleague.com (kringgår CORS/blockering)
api/odds.js       ← proxy mot odds-api.io: hämtar odds, matchar mot FPL-id, cachar
CLAUDE.md         ← stående instruktioner, läses varje session
HANDOFF.md        ← detta dokument
.gitignore        ← håller .env*.local och .vercel utanför repot
README.md
```
VIKTIGT: API-filerna MÅSTE ligga i `api/`-mappen och heta exakt `*.js`
(en gång låg de i roten → 404; en gång hette en fil `fpl.js.` med extra punkt → 404,
syntes inte ens i Vercels function-loggar). Deploy sker automatiskt vid git-push.

## Miljövariabel (Vercel → Settings → Environment Variables)
- `ODDS_API_KEY` = nyckel från odds-api.io. Roterad 26 aug 2026; den gamla,
  som lästes in i en tidigare chatt, är död. Ligger ENDAST på servern.
- Obs: `vercel env pull` hämtar **development**-miljön som standard, och nyckeln
  ligger på Production. Använd `vercel env pull .env.local --environment=production`.

## Odds-pipeline (api/odds.js)

**Leverantörens plan (mätt och dokumentationsbelagt 2026-10-29).** Det här
avsnittet påstod tidigare att "gratisnivån ger Bet365 + Unibet". Det var fel,
och det antagandet höll hela oddsmodellen nere i dagar. Så här är det:

- Gratisplanen ger **100 anrop i timmen, tak 500 per dygn**. Nya gratisnycklar
  är pausade; den vi har lever vidare.
- Man **väljer själv** vilka bokmakare som ingår i svaren, och planen bestämmer
  antalet platser. Gratis ger **två**. Bet365 ligger bakom betalplan, så att be
  om den gav 403 på *varje* match. Kontot har sedan 2026-10-29
  **Unibet + Paddy Power**.
- **`ODDS_BOOKMAKERS` MÅSTE följa panelen.** Att be om en bok som inte ligger i
  en slot ger 403 på HELA anropet, inte bara på den boken. Det har hänt två
  gånger: först med Bet365, sedan när slotarna byttes till Paddy Power medan
  koden fortfarande bad om William Hill. Byt alltid båda samtidigt.
- Slotarna kan bara rensas **en gång per 12 timmar**, och medan de står tomma
  fyller leverantören dem automatiskt vid nästa `/odds`-anrop. Spara direkt.
  Miljövariabeln är nödutgången: den styr vad vi *ber om*, slotarna vad kontot
  *får hämta*, så ett dåligt andraval neutraliseras utan att röra panelen.
- Att be om en bokmakare kontot inte valt ger 403. Att utelämna parametern helt
  ger 400 `Missing bookmakers`. Den är obligatorisk.

**Endpoints.** Bas `https://api.odds-api.io/v3`.

| Endpoint | Kostar | Vad |
|---|---|---|
| `/events?sport=football&league=england-premier-league` | 1 | kommande matcher |
| `/odds/multi?eventIds=…&bookmakers=…` | **1 per tio matcher** | marknader |
| `/markets?sport=football` | **0, ingen nyckel** | marknadskatalogen |
| `/bookmakers` | **0, ingen nyckel** | namn + `status`/`reason` |

**Vilka marknader boken faktiskt bjuder (mätt 2026-10-29 via
`coverage.marketsSeen`).** Unibet ger 48 marknader på PL-matcher. Två som vi
tidigare antog fanns gör det **inte**:

- **`Clean Sheet Home` / `Clean Sheet Away` finns inte.** Namnen är rätt
  (`/markets` bekräftar dem), boken prissätter dem bara inte. Ankaret är därför
  `Team Total Home` / `Team Total Away`, som finns och är **bättre**: clean
  sheet ger bara P(0 mål), lagtotalen ger hela mållinjen. Se
  "Marginalkalibrering" nedan.
- **Unibet har ingen assistmarknad.** Paddy Power har både `Player To Assist`
  och `Player To Score or Assist`. Vi läser **`Player To Assist`**, som är
  direkt P(assist). Den andra är P(mål ELLER assist) och kräver både P(mål)
  och en antagen korrelation för att bli användbar.
- **När två böcker har samma marknad tas den med flest selektioner**, aldrig
  den första i JSON-svaret (`findMarket`). Nyckelordningen är godtycklig:
  Paddy Power kom först och listade färre målskyttar, vilket tyst tappade 28
  spelare. Marknaden tas från EN bok, aldrig sammanslagen — böckerna har olika
  marginal och kalibreringen anpassar en exponent per lag.

Finns: `Anytime Goalscorer`, `To Score 2+/3+ Goals`, `Team Total Home/Away`,
`Totals`, `ML`, `Correct Score`, `Both Teams To Score`, `Double Chance`,
`Draw No Bet`, `Spread`, plus skott-, hörn-, kort-, foul- och
målvaktsräddningsmarknader.

De två sista är gratis och kräver ingen nyckel. **Felsök alltid där först** —
de svarar på "heter marknaden så här?" och "är boken uppe?" utan att kosta ett
enda anrop av kvoten.

Använd **aldrig** `/odds?eventId=` i en loop igen. Det var ett anrop per match,
alltså elva per uppdatering. Under ett avbrott lever ett tomt svar tio minuter,
vilket gav sex uppdateringar i timmen gånger elva = 66 av 100 enbart på
omförsök. Boten var sin egen rate limit och fick 429 på samtliga matcher.
`/odds/multi` tar tio matcher i ETT anrop: en omgång kostar 2, en dubbelomgång
på 16 matcher kostar 3, värsta fallet under avbrott 12 i timmen.

**Kvoten läses ur svaret.** Varje svar bär `x-ratelimit-limit`,
`-remaining` och `-reset`. De rapporteras i `coverage.rateLimit`. Utan dem gick
"slut på kvoten" inte att skilja från "leverantören krånglar" — båda syns bara
som 429.

**Cache:** 6h vid lyckat svar (in-memory + CDN `s-maxage`). Ett svar där inga
odds kom igenom cachas bara 10 minuter — ett misslyckande får inte ligga kvar
som om det vore data, men noll cache gör saken värre under ett avbrott.
- **Matchurval:** en omgång är precis de matcher som ligger mellan sin egen
  deadline och nästa omgångs deadline. Använd ALDRIG "de N första" igen — det
  antar både datumordning och att en omgång är tio matcher, vilket är fel åt
  båda hållen vid dubbel- och blankomgång. Taket `MAX_EVENTS` skyddar kvoten.

**Lagmatchning.** odds-api.io returnerar klubbens officiella namn *med FC/AFC-affix*
("Everton FC", "Sunderland AFC", "AFC Bournemouth"); FPL gör aldrig det. `normTeam()`
tar bort affixet. `TEAM_ALIASES` innehåller numera BARA äkta namnskillnader där FPL
använder en kortform som inte går att härleda ("Tottenham Hotspur" → "Spurs").
Lägg aldrig in FC/AFC-varianter där — regeln sköter dem.

**Spelarmatchning.** Indexeras på både `second_name` och `web_name`, och på
**varje led** i efternamnet (partiklar som de/da/van bortfiltrerade), eftersom
iberiska och brasilianska namn bär två efternamn där det första används —
"Yéremy Pino Santos" kallas Pino. Indexet är avsiktligt brett; precisionen
ligger i kravet på entydighet, inte i hur smalt vi indexerar. Dessutom (FPL lägger ofta
det namn spelaren kallas i web_name — Igor Thiago heter "Nascimento Rodrigues" i
second_name). Förnamn indexeras medvetet INTE. Etiketten matchas mot **båda** lagen
i matchen samtidigt och måste peka ut exakt en spelare; annars hoppas den över.
Bindestreck hålls ihop ("Gibbs-White" är inte "white").

**Marginalkalibrering.** Ankaret är lagets förväntade mål, `lambda`, läst ur
`Team Total Home`/`Team Total Away` (`lambdaFromTeamTotal`). Marknaden är
tvåsidig, så marginalen normaliseras bort rad för rad:
`P(over) = (1/o_over) / (1/o_over + 1/o_under)`. Marginalen försvinner helt i
kvoten. **Bara halvlinjer** används; på en heltalslinje är exakt N mål en push,
så sidorna summerar inte till ett. `lambda` söks så att Poisson träffar alla
erbjudna linjer bäst (boken ger normalt två till fyra).

Hållen nolla faller ut gratis: ett lag håller nollan precis när motståndaren
gör noll mål, alltså `csProb = e^-lambda(motståndaren)`.

Anytime saknar nej-sida och kalibreras lagvis: summan av anytime-
sannolikheter är väntevärdet för antalet olika målskyttar och kan aldrig
överstiga `lambda`. Vi söker exponenten `alpha` så att
`sum(p^alpha) = lambda`. Potens, inte platt tal, eftersom marginalen sitter i
långskotten — mätt låg summan 2,7 gånger över taket för alla 20 lag.

Mätt 2026-10-29: `lambda` återvinns exakt (till rutans 0,01) i 72 fall,
`lambda` 0,6–3,5, en till tre linjer, marginal 0/6/12 %. Observera vad det
*inte* visar — testet genererar oddsen ur samma Poisson-antagande som inversen
använder, så det verifierar inversionen, inte att bokens linjer är Poisson.
De-vigging-steget är däremot exakt oberoende av det.
Rör aldrig anytime som rå `1/odds` igen; det snedvrider rankningen mellan
positioner, vilket är exakt vad Kapten- och Byten-flikarna gör.

**Saknas ankaret slopas spelarna.** Clean sheet-oddsen är det enda ankaret vi
har, så utan dem går marginalen inte att mäta. Koden lämnade förut
sannolikheterna råa och "sa det i svaret". Det var en tyst fallback:
`coverage.uncalibratedTeams` rapporterade saken, men frontend läste aldrig
fältet och matade in talen i xP ändå. Badgen sa "Odds-modell aktiv, 0/10 lag"
samtidigt som 289 spelares poäng byggde på odds.

Mätt på det cachade svaret 2026-10-29 mot FPL:s egen xG: summan låg över
taket för **samtliga 20 lag**, median 1,64 gånger, Tottenham 3,24. Nu slopas
de berörda spelarna, och boten går på sin egen xG-modell som faktiskt är
mätt och kalibrerad. Hellre ingen odds än odds vi inte kan de-vigga.

**Returnerar:**
```
{ updated,
  byTeam:   { fplTeamId: { csProb } },
  byPlayer: { fplPlayerId: { anytimeProb, assistProb } },
  coverage: { gameweek, eventsInWindow, eventsRequested, eventsFailed,
              teamsWithOdds, bookmakers: [], marketsSeen: [],
              rateLimit: {limit, remaining, reset}, unmappedTeams,
              unmatchedLabels: {count, sample}, ambiguousLabels: {count, sample},
              calibration: {fplTeamId: alpha}, uncalibratedTeams: [] } }
```
`coverage` är avsiktligt en del av kontraktet: allt som tappas ska gå att se utan
API-nyckel. Läs den efter varje deploy.

## xP-modellen (i index.html)
Ersatte en gammal modell som lutade på FPL:s `ep_next` + `form` (svag, trolig orsak
till dålig prestanda förra säsongen). Nya modellen:
- **xMins** (speltidsandel) = andel spelade minuter, krympt mot 0.5 med två
  pseudo-matcher, gånger `chance_of_playing`. Allt xP skalas av denna.
  Använd ALDRIG en fast tröskel här igen: den gamla dämpade allt under 270
  minuter och gav därmed exakt 0.60 åt varenda startspelare de tre första
  omgångarna. `SEASON.gamesPlayed` sätts när bootstrap laddats.
- **Anfall** från odds (anytime goalscorer) om tillgängligt, annars xGI-per-90-proxy.
- **Clean sheet** från odds (Clean Sheet Home/Away) om tillgängligt, annars Poisson
  på `expected_goals_conceded_per_90` + hemmaplan.
- Assist från "Player To Score or Assist"-marknaden.
- Badgen visar täckningen ("Odds-modell aktiv · 20/20 lag") och listar de lag som
  körs på xG. Grön prick bara vid full täckning.

**Gameweek:** `squadGw` = omgången truppen hämtas för (senast spelade), `gw` = den
omgång allt planeras mot (`is_next`). Blanda aldrig ihop dem. Båda kastar fel om
förutsättningen saknas — ingen fallback.

## Aktuell trupp — bokmärkesknappen
FPL publicerar en omgångs trupp först efter dess deadline, så byten inför nästa
omgång är osynliga publikt. Verifierat: `/entry/{id}/event/{n}/picks/` ger 404,
`/entry/{id}/transfers/` ger tom lista, `/my-team/{id}/` ger 403.

**Serversidig inloggning är stängd och ska inte försökas igen.**
`users.premierleague.com` finns inte längre (NXDOMAIN), efterföljaren
`account.premierleague.com` svarar 403 på allt även med fullständiga
webbläsarheaders. Att ta sig förbi skulle kräva att kringgå deras botskydd.

I stället: en bokmärkesknapp John klickar när han är inloggad på FPL. Den läser
`/api/my-team/` med hans egen session och skickar resultatet i URL-fragmentet,
som aldrig når någon server. Boten validerar hårt och förkastar hellre än
gissar — fel antal spelare, fel fälttyper eller fel omgång kastas.

`transfers` ur `/my-team/` ser ut så här:
`{bank, cost, limit, made, status, value}`. **`limit` är tilldelningen, inte
återstoden** — rätt formel är `max(0, limit − made)`. Att läsa `limit` rakt av
gav 1 när FPL:s eget UI sa 0. `value` ger truppvärdet i tiondelar.

**Bokmärkeskoden ligger nu i repot:** `bookmarklet.js` (läsbar, kommenterad) och
`bookmarklet.min.txt` (raden att klistra in som bokmärkets adress). Den låg
tidigare bara i en chatt, vilket gjorde den ogranskningsbar — och därför stod
felet nedan oupptäckt.

Den skickar `{entry, gw, picks, bank, freeTransfers, raw}` base64-kodat i `#team=`.

**Ändrat 2026-10-29: knappen fungerar för vem som helst.** Lag-id lästes
tidigare ur en hårdkodad konstant (1036486), vilket gjorde den obrukbar för
Richard — `/api/my-team/<någon annans id>/` ger 403. Nu läses id ur
`/api/me/` → `player.entry`, alltså den inloggade sessionen. **Samma bokmärke
fungerar för alla.**

Nyttolasten bär därför `entry`, och boten sparar under `glennos:myteam:<entry>`
i stället för under det *aktiva* lagets nyckel. Utan det kunde Richards trupp
hamna under Johns nyckel. Hämtas ett annat lag än det som visas byter boten
till det och laddar om, eftersom `TEAM_ID` sätts vid sidladdning.

Trupper sparade före detta saknar `entry` och **förkastas en gång**. Avsiktligt:
en trupp som inte går att knyta till ett lag är inte sann för någon.
Detaljer som ser fel ut men är rätt: `bank` skickas i **tiondelar** (boten
dividerar med 10) och `freeTransfers` skickas som `limit` (boten räknar om till
`limit − made` ur `raw`). Rör inte utan att läsa `index.html` först.

**Rättat 2026-10-29: `picks` skickas HELA.** Den gamla versionen gjorde
`picks: t.picks.map(x=>({element, position, is_captain, is_vice_captain}))` och
kastade därmed `selling_price`. Boten visade "Säljpris saknas" tills detta
rättades. Utan fältet går budgeten inte att räkna: FPL säljer till inköpspris
plus halva vinsten, så dagspris **överskattar** vad man har råd med. Uppmätt på
GW8-truppen: 1,8m fel fördelat på sju spelare. Det publika picks-anropet bär
inte fältet alls, så bokmärkesknappen är enda källan.

## Regler som läses ur API:t, inte hårdkodas
- **Formation:** `element_types[].squad_min_play` / `squad_max_play`.
  `bestXI()` är uttömmande över alla lagliga formationer — bevisat optimalt.
- **Max per klubb:** `game_settings.squad_team_limit`. `buildRecs` kände inte
  till den och föreslog Maguire med tre MUN-spelare redan i truppen. Spelaren
  som går ut frigör sin klubbplats, så byten inom samma klubb är lagliga.
- **Chipfönster:** `bootstrap.chips`.

Lägg inte tillbaka någon av dem som konstant.

## Flikar i boten
**Veckan** (default), Kapten, Byten, Fixtures, Chips, **Analys**, Skador — i den
ordningen, för att det är hur ofta de faktiskt påverkar ett beslut. Flikarna bor
i railen till vänster.

Veckan svarar nu också på **laguppställningen**: vilka som ska in, vilka som
bänkas och en mening om varför, plus bänkens ordning för auto-bytena.

`Veckan` är startvyn och svarar på vad som ska göras i omgången, i vanliga
meningar: kaptensbandet, transfer med rak dom (inklusive "gör ingen transfer"),
sedan skador, chips kvar och bänkens täckning. Varje block länkar vidare till
fliken med siffrorna. Principen är att en nybörjare ska kunna läsa vyn på tio
sekunder och sluta med ett beslut — allt annat är fördjupning.

**Borttagna med flit, återinför dem inte:** Yolo-pick (rankade på lågt ägande
med en påhittad vikt, och dubblerade Bytens differentiella förslag), Momentum
(flockbeteende utan koppling till modellen) och Priser (spelar närmast ingen
roll innan man börjar bygga lagvärde).

## Transferkostnad
`freeTransfersFor()` härleder fria transfers ur `/entry/{id}/history/` — FPL
exponerar dem inte som fält. Regler ([källa](https://www.premierleague.com/en/news/2174907)):
första omgången har obegränsade transfers, sedan en per omgång, oanvända rullar
till tak fem, och wildcard/free hit förbrukar inte bankade. Varje transfer
därutöver kostar 4 poäng.

Bytesförslagen visar **nettot**, inte den nya spelarens xP. Långsiktiga förslag
jämför vinsten över fem omgångar mot engångsavdraget. Går inget alternativ plus
säger boten rakt ut att rätt drag är att inte göra något.

## Chips
`chipAvailability()` läser fönstren ur `bootstrap.chips` (varje chip finns en
gång per säsongshalva) och använda chips ur `/entry/{id}/history/`. Använda
markeras SLUT i stället för att få en rekommendation. GW20 återställer
tillgängligheten för andra halvan.

Obs: de gamla tröskelvärdena (`avgTeamFdr3 > 3.3` → "KÖR NU") är **borttagna**.
De var handplockade utan stöd. Återinför dem inte. Chip-värdet räknas ut, se
nedan.

## Template-XI
`templateXI()` bygger den mest ägda lagliga elvan och startvyn visar hur många av
dina elva som finns i den. Det är **ägarandel, inget annat** — se öppen tråd 3.

## Chip-rådgivning
Ett chip är värt exakt den xP det tillför, och den siffran räknas ut i stället
för att jämföras mot en tröskel. Bench Boost = bänkens xP **minus** vad
auto-bytena ändå ger (se `benchBoostGain`; raden påstod "bänkens xP" ända fram
till `430f2aa` och var då fel med 40–96 %). Triple Captain = ett extra varv av
bästa spelaren, med vice-termen. Free Hit får **ingen** xP-summa här — se
stycket nedan. Varje chip jämförs också mot de fem kommande omgångarna.

**Wildcard får ingen siffra** och ska inte ges en. Det byter hela truppen och
värdet beror på vilket lag man skulle bygga i stället — modellen kan inte räkna
ut det. Den redovisar startelvans xP per omgång, andelen hemmamatcher, skadade
och omgångar kvar, och säger att beslutet är ett omdöme.

**Free Hit får sin siffra från lagbyggaren.** Värdet är gapet mellan bästa
endagstrupp budgeten räcker till och den elva du redan har. Det gamla måttet
("vad du förlorar på spelare utan match") missade det vanligaste läget: att
flera lag har lätta matcher och du inte äger deras nyckelspelare. Kortet visar
ingen siffra förrän knappen tryckts, eftersom talet kräver truppvärdet.

`chipGainsOverHorizon` räknar därför **bara antalet** blanka startspelare, inte
någon xP-summa. Fram till 2026-10-30 räknade den också en summa, och den var
fel: blanks värderades mot `gw` i stället för mot sin egen omgång `g`, och en
blank spelare saknar per definition match i sin egen omgång. Uppmätt med en
syntetisk blank på Haaland gav summan 0,000 trots 3,15 xP/omgång i
`estimateXpLong`. Talet lästes dock aldrig — `line("fh", …)` anropades inte och
fh-kortet sätter `gain:null` — så ingen felaktig siffra visades. Återinför ingen
sådan summa; `freeHitGain` är den enda vägen till Free Hits värde.

**Mätt 2026-10-30: inga riktiga blanka omgångar finns i fixturelistan för GW9–38
än.** Alla 20 lag har match i varje omgång. Blanks uppstår först när cupmatcher
flyttar ligamatcher, och FPL hade inte publicerat det. Konsekvensen: allt som
rör blanks går *inte* att testa mot live-data — det kräver en syntetisk blank
(ta bort lagets post ur fixturekartan `fm` för en omgång).

De gamla trösklarna (`avgTeamFdr3 > 3.3`, `benchXp >= 14`) var handplockade utan
stöd, och en "för"-punkt påstod att Bench Boost ger 6–8 poäng i snitt utan
källa. Återinför inget av det.

## Tillförlitlighet — den bärande regeln
Flera funktioner är byggda **innan datan bär**, med flit, för att de blir bättre
för varje omgång. Priset är att var och en måste säga vad den är värd just nu.
`maturity(needed)` jämför spelade omgångar mot vad funktionen kräver och skriver
ut det. **Bygg aldrig en ny funktion på tunn data utan att sätta en
mognadsmarkering på den** — då blir "bygg tidigt" samma sak som att ljuga tidigt.

## Rotationsplan
Bästa elvan i var och en av de fem kommande omgångarna. Bygger på
`estimateXpAt` och samma uttömmande formationssökning som `bestXI`. Blank
markeras rött, dubbelomgång med ². Kräver 4 omgångar för att vara pålitlig.

## Ligan
`/api/league?id=<liga>` — standings plus varje medlems `/history/`, som ger
poäng, rank, bänkpoäng, byten, avdrag och chips per omgång samt antal tidigare
säsonger. Dessutom `picks` per medlem för de **sex senaste** omgångarna: utan
det taket blir det medlemmar × 38 anrop i maj. Cachas 30 min.
`LEAGUE_ID` står överst i index.html.

**Ligans egen `rank` i standings uppdateras bara mellan omgångar.** Placeringen
per omgång RÄKNAS därför här ur de kumulativa totalerna — annars går det inte
att rita hur medlemmarna passerar varandra, vilket är hela poängen med
klätterdiagrammet.

Sex jämförelser: truppöverlapp, kaptensval per omgång, chips kvar i halvan,
bänkskam, avdrag och form (snitt över tre omgångar).

## Serietabellen
Härledd ur matchresultaten. **`bootstrap.teams` ser ut att bära en tabell** —
`played`, `win`, `points`, `position` finns som fält — men de är noll för
samtliga 20 lag hela säsongen. De underhålls inte. Lita aldrig på dem; räkna ur
`team_h_score` / `team_a_score`.

## Eliten — riktig effective ownership
`/api/elite` hämtar `leagues-classic/314/standings` och sedan varje managers
`picks`. Ur det faller ägande, startandel, **kaptensandel** och chip-användning,
alltså äkta EO. 50 lag parallellt på servern, cachat 6h.

**Varning som står i UI:t:** tidigt på säsongen speglar topplistan tur, inte
skicklighet. Uppmätt i GW1: 94 % av topp 50 hade spelat Bench Boost. Kräver 6
omgångar för att betyda något.

## Egna svårighetsbetyg
Lagens anfall och försvar krympta mot ligasnittet. Visas **bredvid** FPL:s, inte
i stället — lagdata så här tidigt är sämre än FPL:s förhandssatta 1–5.

## Självkalibrering
Modellen jämför sina sparade prognoser mot faktiskt utfall och rättar en
systematisk skevhet. Kräver minst **tre** mätta omgångar, och faktorn kläms till
0,7–1,4 så en enskild galen omgång inte kan kapa modellen. Är 1 tills dess.

Nycklar i localStorage: `glennos:predictions`, `glennos:actuals`,
`glennos:accuracy`, `glennos:myteam`. Hette `gafferos:*` före 28 aug 2026 och
migreras en gång vid start — **ta inte bort migreringen** förrän du vet att
ingen webbläsare har gammal data kvar.

## Facit — efterhandsanalys
Egen flik. Bygger på `/event/{gw}/live/`, som ger varje spelares **faktiska**
poäng för omgången, plus picks och `entry_history`.

Tre delar: resultat mot snittet och `highest_score`, kaptensvalet, och bänken.

**Två saker som är lätta att räkna fel på — ändra dem inte:**
- Kaptensbandet ger **ett** extra varv av spelaren, inte dubbla. Förlusten mot
  ett bättre val är alltså differensen rakt av, inte 2×.
- Poäng på bänken är **bara** förlorade om en startspelare uteblev och
  auto-bytet gick in. Spelade alla elva fanns de aldrig att hämta, och då säger
  vyn det i stället för att skuldbelägga.

**Boten dömer sig själv.** `savePredictions()` sparar xP per spelare för den
omgång vi planerar mot, före deadline. `buildAccuracy()` jämför i efterhand:
medelavvikelse i poäng samt mest under- respektive överskattad spelare. En
prognos **skrivs aldrig över i efterhand** — då vore facit meningslöst.
Träffsäkerheten visas först när det finns en sparad prognos, alltså från GW2.

Felet över tid är också signalen för när solvern är värd att bygga: krymper
medelavvikelsen bär grunden, annars inte.

Ej byggt men billigt: **bytesdomen** — sålde du någon som sedan sprängde?
`/entry/{id}/transfers/` plus live-poäng ger svaret.

## Diagram — byggda
Ligger i Analys-fliken. Regler ur §11: en accent per serie, gridlines på 6%
vitt aldrig ovanpå datan, ytterlägen märkta i stället för varje tick.

1. **xP-nedbrytning** — staplad stapel per spelare ur `estimateXp().parts`.
2. **xP per kommande omgång** — ytgraf, röd punkt vid blank omgång.
3. **Truppvärde fördelat** — donut, summerar till FPL:s eget värde.
4. **Poäng per omgång mot ligasnittet** — `history.current[].points` mot
   `events[].average_entry_score`. Heter så för att top-10k-data inte finns.
5. **Hotanalys** — xG, xA, `threat`, `creativity`. "Shots in box" och "big
   chances" ur guidens exempel finns inte i API:t.

## /api/fpl — vitlistad, inte fri

Proxyn släpper igenom **exakt de sju sökvägar boten begär** och inget annat:

```
/bootstrap-static/        /fixtures/
/entry/{id}/              /entry/{id}/history/
/entry/{id}/transfers/    /entry/{id}/event/{gw}/picks/
/event/{gw}/live/
```

Lägger du till ett `fplFetch` i `index.html` **måste** mönstret in i
`TILLATNA` i `api/fpl.js`, annars svarar proxyn 400. Det är meningen: en ny
väg ska synas direkt i stället för att bli en ny lucka.

Fram till 2026-10-30 fanns ingen kontroll alls. Uppmätt mot skarpa deployen
samma dag: `/leagues-classic/314/standings/`, `/element-summary/411/`,
`/event-status/` och `/entry/1/` gav alla 200 — en gratis FPL-proxy på
kontots kvot, med botens IP-rykte som insats.

**Värden gick däremot aldrig att byta**, vilket prövades: tio försök
(`//evil.example/x`, `https://evil.example/`, `@evil.example/`, `/../../..`,
`..%2F`, backslash, tabb, fragment) gav alla host
`fantasy.premierleague.com`, eftersom basen slutar på `/api` och allt som
följer därmed är en sökväg. Det var kvotmissbruk, inte SSRF — återutred inte
det som SSRF.

**Ingen `Access-Control-Allow-Origin`.** Boten hämtar `/api/fpl` relativt och
är samma origin som funktionen, även i iframen (iframens dokument är
vercel-adressen). Samma origin frågar aldrig efter CORS. Sätt inte tillbaka
en stjärna; behöver något på en annan domän anropa vägen är svaret en
namngiven domän.

## Iframe-höjden — och hur man mäter den

Boten ligger i en `<iframe>` på wennerqvist.design och rapporterar sin egen
höjd till föräldern med `postMessage({type:"glennos:height"})`. En
`ResizeObserver` på `document.documentElement` driver det.

**Effekten går inte att mäta när boten är öppen direkt.** Första raden är
`if(window.parent===window) return;`, så på toppnivå skapas ingen observer
alls. Mätning kräver en föräldersida med en iframe. Gör den
**samma origin** som boten (servera den från samma port på en egen sökväg),
annars når du inte `iframe.contentWindow` från föräldern.

Räkna observers genom att linda konstruktorn i sidan innan babel-blocket:

```js
const R=window.ResizeObserver; window.__ro={skapade:0,rivna:0};
window.ResizeObserver=function(cb){ window.__ro.skapade++;
  const o=new R(cb); const d=o.disconnect.bind(o);
  o.disconnect=function(){ window.__ro.rivna++; return d(); }; return o; };
```

**Fallgrop i mätningen:** när föräldern satt iframens höjd till innehållets
höjd slutar `scrollHeight` ändra sig, så flikbyten ger inga nya meddelanden
även om allt fungerar. Det är en stabil jämvikt, inte ett fel. Vill du prova
att observern lever: krymp iframen från föräldern så svämmar innehållet över
och höjden växer igen.

**`useEffect` utan beroendelista körs vid varje omrendering.** Här rev det upp
observern varje gång. Sedan nedräkningen (`790692f`) renderar om `App` var
30:e sekund gällde det även en helt orörd flik — ~2 880 rivna observers per
dygn. Åtgärdat med `},[])`; blocket stänger inte om någon state, så listan är
säker.

## Deadline

`bootstrap.events[]` bär **tre** deadlinefält: `deadline_time` (ISO-sträng,
UTC), `deadline_time_epoch` (**sekunder**, inte millisekunder) och
`deadline_time_game_offset`. Verifierat mot live bootstrap 2026-10-30: GW9 gav
`1793444400` respektive `2026-10-31T11:00:00Z` — samma tidpunkt, så fälten är
utbytbara. Boten använder epoch, eftersom den inte kan tolkas fel av någon
webbläsare.

Visas på två ställen: nedräkning som nyckeltal (**Till deadline**) och den
absoluta tidpunkten i huvudraden. Under tre timmar kvar färgas siffran
`T.warn`.

**`is_next` kan peka på en omgång vars deadline redan passerat.** Därför är
"passerad" ett eget läge i `tidTill` i stället för ett negativt tal — rådet
går då inte längre att handla på. Antag inte att `is_next` flyttas i samma
sekund som deadline löper ut.

Nedräkningen drivs av en `setInterval` på 30 s i `App` som bara sätter en
tidsstämpel. Det ger en omrendering varje halvminut; kontrollerat att inget
tungt hänger i den vägen — `buildChipAdvice` är det enda omemoiserade och
kostar 4,2 ms. `buildPlan` och `buildRecs` ligger i `useMemo`.

## Färg och kontrast — regler som är uppmätta

**Varje textton ska klara WCAG AA (4,5:1) mot ALLA fyra ytorna** — `bg`,
`surface`, `card`, `overlay` — inte bara mot `bg`. Att bara kolla mot `bg` är
hur felet uppstod: `dim` låg på 4,33:1 där men 3,39:1 mot `overlay`.

**`dim` gäller platta ytor. Ligger texten på en färgton är `mut` den enda
tillåtna tonen.** Fixturebrickorna, svårighetsbrickorna, positionsmärkena —
allt med en `rgba(...)`-bakgrund. Uppmätt 2026-10-30: `dim` gav 2,81–4,44:1
på de tonerna, `mut` ger 5,91–7,00:1.

**Ingen opak ljus färg i paletten.** Appen är mörk och texten är ljus. En
hårdkodad `#FAEFEC` som bakgrund på skadekorten gav 1,03:1 — vit text på vit
platta. Vill du ha en tonad varningsyta finns `T.warnBg` och `T.badBg`, båda
`rgba` över den mörka ytan.

Mätt värden 2026-10-30 (efter fix):

| Ton | bg | surface | card | overlay |
|---|---|---|---|---|
| `ink` #F2F5F8 | 18,22 | 17,28 | 15,94 | 14,26 |
| `mut` #A7B0BD | 9,10 | 8,63 | 7,96 | 7,13 |
| `dim` #818B98 | 5,77 | 5,48 | 5,05 | **4,52** |
| `disabled` #778396 | — | — | **4,54** | — |

`dim` ligger medvetet på det **ljusaste som behövs** och inte ljusare: högre
och tonen går inte att skilja från `mut`, och trestegshierarkin
`ink`/`mut`/`dim` kollapsar till två.

**Varning:** `T.neutral` står kvar på gamla `#6C7684` och är oanvänd. Används
den någonsin återinförs felet — byt den då, mät inte om.

### Så mäter du kontrast

Läsa koden räcker inte: bakgrunden är ofta flera `rgba`-lager, och den
verkliga färgen finns bara i DOM:en. Kör ett skript i sidan som för varje
textnod går uppåt i trädet, komposterar alfa-lagren till en opak färg, och
jämför mot AA-tröskeln för nodens **egen** `fontSize` och `fontWeight`
(4,5:1, eller 3:1 vid ≥24 px eller ≥18,66 px fet). Svep alla tio flikarna och
**båda lagen** — Johns har säljpriser, Richards inte, och de renderar olika
grenar. Så hittades fyra fel som granskningen hade missat.

## Utseende — GlennOS designsystem v1.4
Källa: `FPL Design System.pdf` på Johns skrivbord. Läs den med poppler
(`pdftotext -layout` för text, `pdftoppm -png -r 110 -y N -H M` för utsnitt) —
texten räcker INTE, det visuella bär detaljer som inte går att läsa sig till.

**Klart (steg 1 av 3):** färg, typografi, rytm.
- Paletten ligger i `T`. Fyra ytnivåer, elevation genom yta och inte skugga.
- `T.brand` / `brandHover` / `brandPress` är **interaktionslägen**, inte fria
  nyanser: hover är ljusare (300), press mörkare (700). Blanda inte ihop dem.
- Lime är ENDA varumärkesaccenten — primär åtgärd, aktivt läge, eget lag.
  Grönt och rött bara för verklig numerisk riktning, aldrig dekoration.
- FDR-rampen är borttagen. Fixturöversikten färgas av `fxTone`, som jämför
  spelarens xP mot hans eget snitt över fönstret.
- Archivo för text, IBM Plex Mono för varje siffra, alltid `tabular-nums`.
- 4px-grid i `SP`, radius i `R`.

**Viewport-meta:** filen saknade `<meta name="viewport">` fram till 4 sep 2026.
Utan den ger mobilwebbläsare sidan en låtsasbredd på 980px och skalar ned den,
så inga mobilregler slår till — man får desktoplayouten hopkrympt. Det gällde
även förhandsgranskningspanelen, vilket ledde mig till den felaktiga slutsatsen
att panelen inte kunde gå smalare än 980. **Ta aldrig bort den taggen.**

**Mobilmenyn ligger i flödet (13 sep 2026).** Den var `position:fixed` med
hårdkodad `top:56px` medan topplisten mätte 65px, och på telefonen hamnade
John-knappen under listen och gick inte att trycka på. Nu ligger menyn direkt
under listen och döljer `main` när den är öppen. Gör den inte fast igen: i
Webflow-iframen räknas fast position mot hela iframen.
**Ingen `100vh` på något som påverkar dokumenthöjden.** `.shell{min-height:100vh}`
plus topplisten gav en återkopplingsloop i iframen (vh = iframens höjd, som
sätts från dokumenthöjden): uppmätt 71 856 → 139 658px på några sekunder.

**Klart (steg 2):** layout. 264px rail med etiketter, kollapsar till 54px
ikoner under 1280 och bottenrad under 600. Verifierat på riktig telefon.

**Klart (steg 3):** diagram, se ovan.

**Planvy och spelarkort:** spelarna radas per position som hos FPL så
formationen går att läsa av. Lagfärger ligger i `TEAM_COLOR` nycklad på
`short_name` — FPL exponerar inga färger alls. Uppdatera vid upp- och
nedflyttning; okända lag får neutral list.

## Diagram — vad datan bär
GlennOS §11: en accent per serie, gridlines på 6% vitt aldrig ovanpå datan,
märk ytterlägena i stället för varje tick.

| Diagram | Källa | Status |
|---|---|---|
| Poäng per omgång | `history.current[].points` vs `events[].average_entry_score` | märk som **"du mot snittet"** |
| Truppvärde (donut) | spelarpriser per position + bank | rakt av |
| Rank (ytgraf) | `history.current[].overall_rank` | rakt av |
| Hotanalys | xG, xA, `threat`, `creativity` | se nedan |
| xP-nedbrytning | `estimateXp().parts` finns redan, kastas bort idag | vår egen, billigast att bygga |
| xP per omgång | `estimateXpAt` | vår egen, visar blank/dubbel |

**Finns INTE i FPL:s API, fejka dem inte:** top-10k-jämförelser (inget
kaptensfält alls), "shots in box", "big chances". Guiden visar dem i sina
exempel — det är illustrativ data, vilket står i dess egen sidfot.

## Iframen på wennerqvist.design
Får hela viewportbredden (uppmätt 1728px på en 16" MacBook), så
1440-layouten ryms. Höjden var hårdkodad till 1200px; boten postar nu sin
egen höjd som `{type:"glennos:height"}`. John lägger in lyssnaren i Webflow
— tills dess gäller det fasta talet, och innehållet är 1168px vid 1440 bredd.

## Utseende (äldre anteckningar)
Ett tokenobjekt `T` överst i filen håller hela paletten — mörkt granittema,
varm gråröd sten snarare än blå skiffer, med dova signalfärger. Byt tema där
och i `POS_TINT`, `fxTone`, `xpTone` och `xpColor`, inte inline. Filen har haft
82 hårdkodade färger utspridda i JSX; en av dem gjorde spelarnamnen i
fixturtabellen osynliga när temat byttes. Lägg inte tillbaka några.

## Vad som är mätt, och vad som inte är det (GW9)

Allt nedan är mätt mot riktiga data, inte resonerat fram. Gör om mätningen
innan du ändrar något av det.

**Modellen slår varje naiv gissning.** MAE per spelare och omgång, GW2–GW8 mot
verkligt utfall: modellen 2.49, gissa alltid 2 poäng 3.06, spelarens snitt
hittills 3.60, förra omgångens poäng 3.68, alltid 0 3.99. Måttstocken "gissa 2"
räknas nu ut i Facit per omgång över exakt samma spelare, så jämförelsen är
parad. Ett snittfel utan måttstock säger ingenting — skriv aldrig "rimligt" om
ett tal utan att visa alternativet.

**FDR är borttagen från anfallssidan.** Mätt mot marginalkalibrerade odds för
GW9, 258 spelare: ingen justering 0.2297, FPL:s FDR 0.2308, egen xGC-rating
0.2308, FDR + hemmaplan 0.2154, xGC + hemmaplan 0.2136, **bara hemmaplan
0.2115**. Båda måtten på motståndarstyrka gjorde modellen sämre. Hemmafaktorn
svepte 1.00–1.30 med platt botten 1.16–1.25, satt till 1.20.

**Clean sheet-sidan är mätt och orörd.** Samma metod mot avviggade nolla-odds
för 20 lag: dagens `xgc × hemma × FDR` gav 0.0574 och slog alla sex alternativ.
Utan FDR blir felet 31 procent större. FDR hjälper alltså för hållen nolla och
skadar för anfall. Optimum för konstanterna låg på hemmafaktor 1.10 (exakt
dagens) och lutning 0.20 mot dagens 0.26 — 2,2 procent på 20 datapunkter,
alltså inom bruset. Ändra inte.

**Död kod borttagen:** `buildOwnRatings` och `ownDifficulty` räknades ut vid
varje sidladdning och anropades aldrig, och slog inte FDR på någondera sidan.
Med dem gick `FDR_RAMP`, `fdrBg`, `fdrTx`, `avgFdr`, `nextFdr`, `riskFromFdr`
och `OWN_FDR_PSEUDO`.

**Risk mäts på speltid**, inte på motståndarens FDR. En spelare som inte spelar
ger noll oavsett motstånd, och det är den risk som går att belägga.

**Truppvärdet inkluderar banken.** Mätt över fyra omgångar: `value − bank`
landar på spelarnas prissumma inom 0,1–0,2, medan `value` utan avdrag avviker
med exakt bankens belopp. Lagbyggarens budget är alltså `squadValue`, inte
`squadValue + bank`. Det senare gav 4,3m för mycket och lag som inte gick att
köpa.

## Nyhetspanelen (api/news.js)

Hämtar Fantasy Football Scouts RSS och matchar rubrikerna mot truppen.

**Bara den källan, och det är mätt.** Fyra flöden provades mot truppen. BBC,
Guardian och Sky gav 254 poster där noll av de femton spelarna namngavs
användbart, och namnmatchningen gav falska träffar direkt ("Ashley Williams"
expertkommentatorn mot spelaren N.Williams). FF Scout skriver på spelarnivå
("FPL notes: Pedro injury latest", "2pm team news: Bruno benched") och
informationen ligger i rubriken, så artiklarna behöver aldrig hämtas. Lägg
inte tillbaka de stora källorna.

**Rubrikerna rör aldrig en siffra.** De visas som citat med länk och
tidsstämpel, tydligt avskilda. Modellen säger vad den kan bevisa, panelen
visar vad någon annan påstår. Text från internet är data, inte instruktioner,
och ska aldrig tolkas av en språkmodell som sedan får dra slutsatser.

**Två fällor, båda uppmätta:**

Accenter. Skribenter skriver "Guehi", FPL skriver "Guéhi". Utan
diakritnormalisering gav matchningen noll träffar på en trupp där två namn
bär accent, Guéhi och João Pedro.

Ordnivå. `web_name` är "João Pedro" och `second_name` "Junqueira de Jesus".
Ingen av de hela strängarna matchar rubriken "Pedro injury latest". Matchning
sker därför på varje ord i namnet. Det är samma grepp som en gång gav 16
felaktiga träffar i oddsmatchningen, så det mättes först: på det riktiga
flödet gav det två träffar och noll falska. Skillnaden mot odds är att en
felaktig träff här bara visar en rubrik för mycket, märkt som osäker, i
stället för att tyst flytta en siffra.

Tvetydiga träffar markeras. Ligan har både João Pedro och Pedro Porro, så
"Pedro injury latest" visas med texten att det kan vara en annan spelare.

**Bonusmodellen är mätt och utbytt.** Den gamla termen `ict_index / 38 × 0.15`
delade en kumulativ siffra med hela säsongens längd, som om 38 omgångar redan
spelats, och 0.15 var en gissning. Mätt mot verkligt utdelad bonus, GW5–GW8,
837 spelare-omgångar: ny (bps per 90 × skala) RMSE 0.7444 och bias +0.040,
gammal RMSE 0.7690 och bias −0.201, gissa noll RMSE 0.7912.

Det stora felet var skevheten, inte precisionen. Gamla termen la till 0,73 xP
för en elva när verklig bonus i snitt var 2,94 poäng. För den här truppen gick
bidraget från 1,37 till 3,15 xP. Skalan kalibreras vid varje laddning mot
säsongens faktiska bonusutdelning, som attackScale, och bps per 90 krymps mot
ligasnittet med samma 270 pseudominuter som anfallssidan (uppmätt optimum).

Begränsning som står i koden: bonus delas ut 3/2/1 till de tre högsta bps i
varje match, alltså relativt motståndarna. Termen är ett väntevärde ur
spelarens egen bps-takt och vet inget om vilka han möter.

**Inte mätt:** straffläggare (`penalties_order` finns och är verifierat).
Går att mäta mot utfall när fler omgångar passerat. Bygg det inte på tro
innan dess.

## Nyligen gjort (aug 2026)
- **`98f73dd` — deployad och verifierad i produktion.** Två buggar:
  gameweek-buggen (boten planerade mot senast spelade omgång i stället för nästa;
  20/20 lag hade en redan spelad match först i fixture-mappen), och lagnamnsbuggen
  (sex enordsklubbar — ARS, BRE, CHE, EVE, FUL, LIV — fick noll odds och föll tyst
  till xG medan badgen påstod full odds-modell). Efter deploy: `teamsWithOdds` gick
  från 14 till 20, spelare med odds från 283 till 401.
- **`6ef9784`, `847f198` — deployade och verifierade.** Namnmatchningen slutade gissa.
  Bekräftat fel före fixen: Callum Wilsons (BRE) målskyttodds hamnade på Harry
  Wilson (LEE). Testad mot live FPL-data över GW2–GW10: 12150 etiketter,
  0 felmatchningar, 30 överhoppade (nakna efternamn som två spelare i matchen delar).
  Verifierat i produktion: Callum Wilson fick sin egen anytime 0.333 (som tidigare
  satt på Harry Wilson, som nu har sin riktiga 0.278), Igor Thiago fick odds för
  första gången, och `unmatchedLabels` föll 29 → 25.
- **`6648eb1` — deployad och verifierad.** Marginalkalibreringen (se
  odds-pipelinen ovan). I produktion: `sum(p)` ligger på taket för alla 20 lag med
  0.000000 % avvikelse, alpha 1.53–1.93, inga okalibrerade lag. Haaland 0.619 →
  0.465 (odds 1.61 → 2.15). Effekt: 8 av 11 startspelare byter plats i rankningen,
  försvarare upp och anfallare ner — Shaw 6 → 2, João Pedro 5 → 9.
- **`a6f7a28` — deployad och verifierad.** xMins och kaptensrankningen, se
  xP-modellen ovan.
- **`847f198`…`e71447c` — deployade och verifierade.** Transferkostnad, startvyn
  Veckan, chip-status, borttagna flikar, granittema, deadline-baserat matchurval,
  dubbelefternamn och template-överlapp. Se avsnitten ovan.
- **Ingen dödlopp i kaptensrankningen.** En tidigare anteckning påstod att
  sorteringen valde godtyckligt mellan spelare på samma xP. Den gör inte det —
  Haaland låg på 2.746926 och B.Fernandes på 2.724786; det ser bara oavgjort ut
  för att båda avrundas till 2.7 i visningen.

**Notera:** kaptensvalet ändrades INTE av kalibreringen. En tidigare analys som
bara räknade på odds-delarna förutsade att det skulle göra det; med hela modellen
(xMins, närvaropoäng) står B.Fernandes kvar överst. Räkna alltid på hela xP innan
du påstår något om rankningen.

## Öppna trådar / TODO

0. **CDN-cachen på `/api/fpl` verkar inte ske.** Koden sätter
   `Cache-Control: s-maxage=60`, men skarpa deployen svarade 2026-10-30
   `public, max-age=0, must-revalidate` med `x-vercel-cache: MISS`.
   Mätt med `curl -D-` mot `fpl-bot-lovat.vercel.app`. **Orsaken är inte
   utredd** — det kräver en deploy att pröva, så gissa inte. Konsekvensen är
   att "CDN-cache via Cache-Control" i avsnittet om cacheskikt kan vara ett
   påstående som inte stämmer för den här endpointen; kontrollera innan du
   litar på den.
1. **Besvarad 2026-10-29: nej, ingen av böckerna bjuder clean sheet.** Varken
   Unibets 48 marknader eller Paddy Powers 21 innehåller `Clean Sheet Home` /
   `Clean Sheet Away`, trots att namnen är exakt rätt enligt `/markets`.
   **Spelar ingen roll:** ankaret är `Team Total Home`/`Away`, som är bättre
   — clean sheet ger bara P(0 mål), lagtotalen hela mållinjen. Hållen nolla
   faller ut som `e^-lambda(motståndaren)`. **Stängd.**
2. **Löst 2026-10-29: assistgapet.** Stod här som "`attackScale` drar ner
   hela xG-modellen med 28,6 %". Orsaken var att oddsgrenen var mål-bara
   medan xG-proxyn innehöll assist, så den globala kvoten `sumOdds/sumProxy`
   skalade ner allt. Löstes genom att byta andra bokmakarplatsen till Paddy
   Power, som har `Player To Assist`.

   Mätt före och efter på samma sätt: `attackScale` gick från **0,4920 till
   0,6527**. Assist står nu för 29,7 % av oddssidan, vilket matchar proxyns
   egen assistvikt (0,4×3 av 0,6×goalW+1,2, alltså 25–33 % beroende på
   position). Kvarstående avvikelse mot en lika-mot-lika-skala: **5,3 %**, ner
   från 28,6 %.

   Resten är täckning, inte en bugg: 207 av 303 spelare har assistodds. Att
   jaga de sista fem procenten i kod vore komplexitet för lite. **Stängd.**

   Kvarstående antagande: samma `alpha` appliceras på assist som på mål, trots
   att assistmarknaden bär sin egen marginal. Riktningen är rätt (båda
   krymps), storleken är en gissning. Inte mätt.
3. **Avskriven: William Hill.** Boken svarade aldrig trots att den var vald,
   sparad och `status=ok`, och trots att parametern gick ut korrekt. Orsaken
   blev aldrig fastställd. Ersättes av Paddy Power, som fungerade direkt.
   Teorin att procentkodad avgränsare var orsaken var **fel** — fixen var rätt
   enligt spec men ändrade ingenting.
4. **Löst 2026-10-29: namnmatchningen.** Stod här som "fyra spelare matchas
   inte". Två buggar låg bakom:
   - Tecken som NFD inte sönderdelar **raderades tyst** av `[^a-z]`, vilket
     inte ger ett fel utan ett felstavat namn som aldrig matchar. Uppmätt över
     hela bootstrap: `.` 36 spelare, `'` 7, `ı` 2 (Kadıoğlu, Bayındır), `đ` 1.
     `ı`, `đ` och `ł` translittereras nu, och **punkt blir mellanslag** så
     "J.Timber" ger `timber` i stället för `jtimber`.
   - Uppslaget provade bara **sista ordet** i bokens etikett medan FPL-sidan
     indexeras brett på varje led. Därför föll spelare som kallas vid ett
     mittenled: "Abdul Fatawu Issahaku" heter Fatawu, "Rayan Vitor Simplicio
     Rocha" kallas Rayan. Nu provas alla led bakifrån, men vi stannar vid
     första nyckel som ger träffar och kravet på entydighet står kvar.

   Utfall live: omatchade 4 → 2, spelare med odds 290 → 310, tvetydiga 0. De
   två kvarvarande är **rätt att hoppa över**: "Ephron Mason-Clarke" är en äkta
   stavningsskillnad mot FPL:s "Mason-Clark" där en gissning vore fel, och
   "Malik Olayiwola" finns inte i FPL över huvud taget.

   Regressionstest i skala: var och en av de 451 spelarna med speltid som
   etikett i sin egen match ger 451 rätt spelare, noll fel, noll tvetydiga.
   Kör om teckenmätningen vid säsongsstart — samma teckenklass, nya spelare.
5. **Solvern: mätt 2026-10-29, strålsökningen är inte värd den.**
   Byggd och jämförd mot baslinjer på 20 riktiga trupper från topp 20 i
   totalligan, horisont 5 omgångar, botens egen modell körd ur `index.html`
   i en VM (inte en kopia — se `scratchpad/load.mjs`-mönstret).

   | metod | xP över 5 GW | mot "gör inget" |
   |---|---|---|
   | gör inget | 205,40 | — |
   | girig, denna omgång | 216,46 | +11,06 |
   | girig, horisont | 216,76 | **+11,36** |
   | strålsökning | 217,60 | +12,20 |

   Strålsökningen vinner i 17 av 20 trupper och förlorar i noll, så den är
   genuint bättre. Men bara med **+0,84 xP över fem omgångar**, alltså 0,17 per
   omgång. Den giriga planeraren tar **93 % av hela vinsten**.

   Känslighet: stråle 20→50, par 15→25, kortlista 8→12 flyttade vinsten
   från 0,37 till 0,56 xP på samma 8 trupper, till **fem gånger** räknetiden
   (1,9s → 9s per trupp). Inte konvergerad, men avkastningen är usel.

   Avgörande invändningen: strålens försprång sitter i planeringen av **senare**
   omgångar, och det är precis där modellen är svagast — odds finns bara för
   nästa omgång. Att leta upp en bättre plan enligt en modell som själv har
   MAE 2,49 per spelare och omgång är att finslipa under bruset.

   **Slutsats: bygg den giriga horisontplaneraren, inte strålsökningen.**
   Riggen ligger i scratchpad och är borta vid nästa dag. Mät om innan någon
   bygger strålsökning ändå.
6. **Effective ownership GÅR att bygga.** En tidigare anteckning här påstod
   motsatsen — den var fel. `bootstrap.elements` saknar kaptensfält, men varje
   managers lag är publikt: `/leagues-classic/314/standings/` ger topplistan och
   `/entry/{id}/event/{gw}/picks/` ger deras trupp, kapten och chip. Ägande OCH
   kaptensandel går alltså att räkna fram genom sampling. Uppmätt: 20 managers
   på 0,3 sekunder parallellt.

   Varning: tidigt på säsongen är "topp N" bara de som haft tur i en omgång,
   inte skickliga managers. Siffran blir meningsfull först när ranken hunnit
   stabiliseras.


## Fel som inte får släcka boten

`buildRecs` anropas från **tre** ställen, och alla tre måste hantera ett kast.
Det gjorde de inte fram till 2026-10-30:

| Ställe | Före | Efter |
|---|---|---|
| `TransferPlan` | `try/catch`, returnerade null | oförändrat |
| `WeekTab` (`useMemo`) | inget skydd → **vit sida, hela appen** | fångar, bär felet, visar "Kan inte räkna på byten" |
| `App.runTransfers` | `setAnalyzing(false)` efter anropet → knappen låst på "Analyserar..." för alltid | `finally`, felet i `c.errNote` |

**Ett anrop i en `useMemo` är en rendering.** Kastar det river React upp hela
trädet och sidan blir vit — det är inte en trasig panel, det är en trasig bot.
Uppmätt i webbläsaren med ett injicerat kast.

**Att fånga och returnera tomt är fel här.** Tomt `recs` ger `best = null`,
och då säger Veckan "Gör ingen transfer" och briefen får
`gorIngenTransfer: true` — ett självsäkert råd som ingen räknat fram. Felet
ska bäras vidare och synas. Samma linje som säljpris-grinden redan höll.

Notera att kastet i `buildRecs` (saknade säljpriser) **inte går att utlösa**:
grinden `harSaljpriser([...starters,...bench])` i UI:t är exakt samma predikat.
Skyddet gäller framtida kast, inte ett känt fel.

## Kända fallgropar
- API-filer måste ligga i `api/` och sluta exakt på `.js`.
- FPL:s API blockerar ibland moln-IP:n → därför User-Agent/Referer-headers. Detta
  gäller BÅDA filerna: `api/odds.js` hämtar bootstrap-static direkt och saknade
  headers länge, vilket sporadiskt tog ner hela `/api/odds` med 502.
- Boten är en enda HTML-fil med React via Babel-standalone (ingen byggkedja).
- **Pusha tidigt.** Repot tömdes en gång lokalt (26 aug 2026) — allt som bara fanns
  som lokal commit var borta. GitHub-remoten var enda räddningen. En commit som inte
  är pushad finns inte.
- Kör git- och vercel-kommandon från repo-roten. `vercel link` körd från hemkatalogen
  länkar `~` till projektet i stället för repot.
- **Dubbelomgångar: fixat 2026-10-29.** `byTeam` och `byPlayer` bär nu **en post
  per match**, inte en per lag/spelare: `[{oppId, home, csProb}]` respektive
  `[{oppId, home, anytimeProb, assistProb}]`. Förut skrevs posten över av den
  sist behandlade matchen, och `estimateXpAt` loopade över båda matcherna med
  samma värde — en dubbel fick alltså den *senare* matchens odds två gånger.

  `cleanSheetProbAt` och `oddsAttackXp` tar nu **matchen**, inte omgången.
  `cleanSheetProbAt` slog tidigare upp matchen själv med `.find()`, vilket tar
  den första — så samma bugg fanns i **xG-grenen helt utan odds**.

  Mätt på en konstruerad dubbel (Gabriel, nolla 0,273 och 0,800): csPts blir nu
  4,29 där de två felaktiga svaren var 2,18 och 6,40, alltså upp till 49 % fel.
  Regression: alla 669 spelares xP **identiska** till 1e-9 för enkelomgångar.

  Noll dubbelomgångar var schemalagda när detta skrevs (GW9–38, och noll
  matcher utan omgång), så buggen var inte nåbar än. Dubblar uppstår när
  cupmatcher tvingar fram ommatchningar, typiskt från december.
- Skriv aldrig "fixad, ej deployad" i det här dokumentet utan att också säga hur man
  verifierar det. Punkt 1 stod så medan fixen inte fanns i repot alls — den kostade
  en session att upptäcka, för påståendet lät trovärdigt.
