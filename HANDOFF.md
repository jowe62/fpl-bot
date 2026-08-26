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
- `ODDS_API_KEY` = nyckel från odds-api.io.
  **Bör fortfarande roteras** — nyckeln lästes in i en tidigare chatt. Ligger
  ENDAST på servern.
- Obs: `vercel env pull` hämtar **development**-miljön som standard, och nyckeln
  ligger på Production. Använd `vercel env pull .env.local --environment=production`.

## Odds-pipeline (api/odds.js)
- Källa: odds-api.io v3. Bas `https://api.odds-api.io/v3`.
  - `/events?sport=football&league=england-premier-league` → kommande matcher
  - `/odds?eventId=…&bookmakers=Bet365,Unibet` → marknader per match
- Bookmakers: gratisnivån ger Bet365 + Unibet, med marknaderna
  "Anytime Goalscorer", "Clean Sheet Home/Away", "Player To Score or Assist".
- Cache: 6h in-memory, hämtar ~10 matcher → skonar gratiskvoten (100 req/h).

**Lagmatchning.** odds-api.io returnerar klubbens officiella namn *med FC/AFC-affix*
("Everton FC", "Sunderland AFC", "AFC Bournemouth"); FPL gör aldrig det. `normTeam()`
tar bort affixet. `TEAM_ALIASES` innehåller numera BARA äkta namnskillnader där FPL
använder en kortform som inte går att härleda ("Tottenham Hotspur" → "Spurs").
Lägg aldrig in FC/AFC-varianter där — regeln sköter dem.

**Spelarmatchning.** Indexeras på både `second_name` och `web_name` (FPL lägger ofta
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

## Flikar i boten
Byten (transferförslag: snabb/långsiktig/differentiell), Yolo-pick, Chips (WC/BB/TC/FH-rådgivare),
Fixtures (FDR-ticker), Kapten (rankad på xP), Momentum (transfers in/ut), Priser, Skador.

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
- **`a6f7a28` — committad, verifiera efter deploy.** xMins och kaptensrankningen,
  se xP-modellen ovan. → Kontrollera att Kapten-listan är monotont sorterad på det
  visade xP-talet och att speltidsandelen skiljer sig mellan spelare.

**Notera:** kaptensvalet ändrades INTE av kalibreringen. En tidigare analys som
bara räknade på odds-delarna förutsade att det skulle göra det; med hela modellen
(xMins, närvaropoäng) står B.Fernandes kvar överst. Räkna alltid på hela xP innan
du påstår något om rankningen.

## Öppna trådar / TODO
1. **Kaptensvikt.** `scoreCap` är borttagen och kapten rankas nu på ren xP. Den
   gamla kommentaren påstod att den straffade lågt xMins hårdare för att gynna
   nagelfasta startare — det var aldrig implementerat. Om du vill ha en sådan
   viktning är den obyggd och ett medvetet modellval, inte en bugg.
2. **Dubbelefternamn.** Boken skriver "Yeremy Pino" och "Bruno Guimaraes" där FPL
   har `Pino Santos` och `Guimarães Rodriguez Moura`; `lastName()` tar sista ordet
   och missar. Sex spelare berörda, samtliga ≤3.2% ägda, så nyttan är liten. De
   syns i `coverage.unmatchedLabels` om någon av dem blir relevant.
3. `upcoming.slice(0, 10)` antar att de tio första pending-matcherna ≈ nästa omgång.
   Håller inte vid dubbel- eller blankomgång.
4. Föreslagna förbättringar (ej byggda), i värdeordning:
   - Flera-omgångars-planering / solver (störst edge, mest jobb) — som FPL Review/Hub.
   - Effective ownership / template-vs-differential-märkning (billig, hög nytta).
5. Gammalt Vercel-projekt `project-h5be9` (gamla proxyn) kan raderas — inget pekar dit längre.

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
