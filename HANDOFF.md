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

**Returnerar:**
```
{ updated,
  byTeam:   { fplTeamId: { csProb } },
  byPlayer: { fplPlayerId: { anytimeProb, assistProb } },
  coverage: { eventsRequested, eventsFailed, teamsWithOdds, unmappedTeams,
              unmatchedLabels: {count, sample}, ambiguousLabels: {count, sample} } }
```
`coverage` är avsiktligt en del av kontraktet: allt som tappas ska gå att se utan
API-nyckel. Läs den efter varje deploy.

## xP-modellen (i index.html)
Ersatte en gammal modell som lutade på FPL:s `ep_next` + `form` (svag, trolig orsak
till dålig prestanda förra säsongen). Nya modellen:
- **xMins** (startchans) från `starts_per_90`, minuter, skadestatus — allt xP skalas av denna.
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
- **`6ef9784` — committad. Verifiera efter deploy.** Namnmatchningen slutade gissa.
  Bekräftat fel före fixen: Callum Wilsons (BRE) målskyttodds hamnade på Harry
  Wilson (LEE). Testad mot live FPL-data över GW2–GW10: 12150 etiketter,
  0 felmatchningar, 30 överhoppade (nakna efternamn som två spelare i matchen delar).
  → Kontrollera efter deploy att Callum Wilson (id 108) och Igor Thiago har odds,
  och att `unmatchedLabels.count` är lågt.

## Öppna trådar / TODO
1. **Vig-inkonsekvensen.** Clean sheet de-viggas korrekt (`y/(y+n)`), men anytime
   goalscorer och assist konverteras med rå `1/odds` och bär alltså bookmakerns
   marginal. Båda summeras i samma `raw` i `estimateXp`, så anfallsdelen är
   systematiskt uppblåst relativt clean sheet-delen — det snedvrider rankningen
   *mellan positioner*, vilket är precis vad Kapten- och Byten-flikarna gör.
   Anytime är inte en ömsesidigt uteslutande marknad, så den går inte att
   normalisera som clean sheet; kräver "nej"-sidan eller en explicit överrundsmodell.
   Störst kvarvarande korrekthetsfråga i modellen.
2. `upcoming.slice(0, 10)` antar att de tio första pending-matcherna ≈ nästa omgång.
   Håller inte vid dubbel- eller blankomgång.
3. Föreslagna förbättringar (ej byggda), i värdeordning:
   - Flera-omgångars-planering / solver (störst edge, mest jobb) — som FPL Review/Hub.
   - Effective ownership / template-vs-differential-märkning (billig, hög nytta).
4. Gammalt Vercel-projekt `project-h5be9` (gamla proxyn) kan raderas — inget pekar dit längre.

## Kända fallgropar
- API-filer måste ligga i `api/` och sluta exakt på `.js`.
- FPL:s API blockerar ibland moln-IP:n → därför proxyn med User-Agent/Referer-headers.
- Boten är en enda HTML-fil med React via Babel-standalone (ingen byggkedja).
- **Pusha tidigt.** Repot tömdes en gång lokalt (26 aug 2026) — allt som bara fanns
  som lokal commit var borta. GitHub-remoten var enda räddningen. En commit som inte
  är pushad finns inte.
- Kör git- och vercel-kommandon från repo-roten. `vercel link` körd från hemkatalogen
  länkar `~` till projektet i stället för repot.
- Skriv aldrig "fixad, ej deployad" i det här dokumentet utan att också säga hur man
  verifierar det. Punkt 1 stod så i månader medan fixen inte fanns i repot alls.
