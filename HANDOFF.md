# FPL-bot — överlämning

## Vad det är
En Fantasy Premier League-rådgivare (frontend, React via Babel i en enda HTML-fil)
som hämtar användarens lag + ligadata och ger förslag på kapten, byten, chips m.m.
Byggd på en egen xP-modell (expected points) plus riktiga bookmaker-odds.

Team-ID: 1036486 (hårdkodat i `TEAM_ID` överst i HTML:en).

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
- Källa: odds-api.io v3. Bas `https://api.odds-api.io/v3`.
  - `/events?sport=football&league=england-premier-league` → kommande matcher
  - `/odds?eventId=…&bookmakers=Bet365,Unibet` → marknader per match
- Bookmakers: gratisnivån ger Bet365 + Unibet, med marknaderna
  "Anytime Goalscorer", "Clean Sheet Home/Away", "Player To Score or Assist".
- Cache: 6h in-memory → skonar gratiskvoten (100 req/h).
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

**Marginalkalibrering.** Clean sheet de-viggas direkt (`y/(y+n)`). Anytime och
assist saknar nej-sida och kalibreras i stället lagvis: summan av anytime-
sannolikheter är väntevärdet för antalet olika målskyttar och kan aldrig
överstiga förväntade mål, som fås ur motståndarens (redan de-viggade) clean
sheet-odds via `P(0 mål) = e^-lambda`. Vi söker exponenten `alpha` så att
`sum(p^alpha) = lambda`. Potens, inte platt tal, eftersom marginalen sitter i
långskotten — mätt låg summan 2,7 gånger över taket för alla 20 lag.
Rör aldrig anytime som rå `1/odds` igen; det snedvrider rankningen mellan
positioner, vilket är exakt vad Kapten- och Byten-flikarna gör.

**Returnerar:**
```
{ updated,
  byTeam:   { fplTeamId: { csProb } },
  byPlayer: { fplPlayerId: { anytimeProb, assistProb } },
  coverage: { eventsRequested, eventsFailed, teamsWithOdds, unmappedTeams,
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

Bokmärkeskoden ligger i konversationen, inte i repot. Behöver den göras om:
den hämtar `/api/my-team/{ID}/` och `/api/bootstrap-static/`, plockar `gw` ur
`is_next`, skickar `{gw, picks, bank, freeTransfers, raw}` base64-kodat i
`#team=` till `https://fpl-bot-lovat.vercel.app/`.

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

Obs: chip-rådgivarens *tröskelvärden* (`avgTeamFdr3 > 3.3` → "KÖR NU") är
handplockade utan stöd. De är inte verifierade mot något.

## Template-XI
`templateXI()` bygger den mest ägda lagliga elvan och startvyn visar hur många av
dina elva som finns i den. Det är **ägarandel, inget annat** — se öppen tråd 3.

## Chip-rådgivning
Ett chip är värt exakt den xP det tillför, och den siffran räknas ut i stället
för att jämföras mot en tröskel. Bench Boost = bänkens xP. Triple Captain = ett
extra varv av bästa spelaren. Free Hit = det du förlorar på spelare utan match.
Varje chip jämförs också mot de fem kommande omgångarna.

**Wildcard får ingen siffra** och ska inte ges en. Det byter hela truppen och
värdet beror på vilket lag man skulle bygga i stället — modellen kan inte räkna
ut det. Den redovisar FDR-snitt, skadade och omgångar kvar, och säger att
beslutet är ett omdöme.

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
- FDR-rampen har neutralt grå trea så en rad medelmatcher läser som tystnad.
- Archivo för text, IBM Plex Mono för varje siffra, alltid `tabular-nums`.
- 4px-grid i `SP`, radius i `R`.

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
och i `POS_TINT`, `fdrBg`, `fdrTx` och `xpColor`, inte inline. Filen har haft
82 hårdkodade färger utspridda i JSX; en av dem gjorde spelarnamnen i
FDR-tabellen osynliga när temat byttes. Lägg inte tillbaka några.

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
1. **Solvern.** Flera-omgångars-transferplanering. Största kvarvarande edge och
   klart mest arbete: en optimering över budget, formation, fria transfers och
   avdrag över N omgångar. Inte påbörjad.
2. **Effective ownership GÅR att bygga.** En tidigare anteckning här påstod
   motsatsen — den var fel. `bootstrap.elements` saknar kaptensfält, men varje
   managers lag är publikt: `/leagues-classic/314/standings/` ger topplistan och
   `/entry/{id}/event/{gw}/picks/` ger deras trupp, kapten och chip. Ägande OCH
   kaptensandel går alltså att räkna fram genom sampling. Uppmätt: 20 managers
   på 0,3 sekunder parallellt.

   Varning: tidigt på säsongen är "topp N" bara de som haft tur i en omgång,
   inte skickliga managers. Siffran blir meningsfull först när ranken hunnit
   stabiliseras.


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
- Skriv aldrig "fixad, ej deployad" i det här dokumentet utan att också säga hur man
  verifierar det. Punkt 1 stod så medan fixen inte fanns i repot alls — den kostade
  en session att upptäcka, för påståendet lät trovärdigt.
