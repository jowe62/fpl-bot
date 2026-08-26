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
index.html        ← hela boten (React/Babel, en fil). Detta är fpl-bot.html.
api/fpl.js        ← proxy mot fantasy.premierleague.com (kringgår CORS/blockering)
api/odds.js       ← proxy mot odds-api.io: hämtar odds, matchar mot FPL-id, cachar
README.md
```
VIKTIGT: API-filerna MÅSTE ligga i `api/`-mappen och heta exakt `*.js`
(en gång låg de i roten → 404; en gång hette en fil `fpl.js.` med extra punkt → 404,
syntes inte ens i Vercels function-loggar). Deploy sker automatiskt vid git-push.

## Miljövariabel (Vercel → Settings → Environment Variables)
- `ODDS_API_KEY` = nyckel från odds-api.io.
  Nyckeln lästes in i en tidigare chatt och bör roteras. Ligger ENDAST på servern.

## Odds-pipeline (api/odds.js)
- Källa: odds-api.io v3. Bas `https://api.odds-api.io/v3`.
  - `/events?sport=football&league=england-premier-league` → kommande matcher
  - `/odds?eventId=…&bookmakers=Bet365,Unibet` → marknader per match
- Bookmakers: gratisnivån ger Bet365 + Unibet, med marknaderna
  "Anytime Goalscorer", "Clean Sheet Home/Away", "Player To Score or Assist".
- Matchning mot FPL: normaliserar bort diakriter (ø/é/ï), matchar på efternamn +
  lag. Lagnamn mappas via `TEAM_ALIASES` (odds-API:ts "Manchester City" → FPL "Man City").
- Cache: 6h in-memory, hämtar ~10 matcher → skonar gratiskvoten (100 req/h).
- Returnerar `{updated, byTeam:{fplTeamId:{csProb}}, byPlayer:{fplPlayerId:{anytimeProb,assistProb}}}`.
- Verifierad fungera: /api/odds gav korrekt JSON, badge i boten visar "Odds-modell aktiv".

## xP-modellen (i index.html)
Ersatte en gammal modell som lutade på FPL:s `ep_next` + `form` (svag, trolig orsak
till dålig prestanda förra säsongen). Nya modellen:
- **xMins** (startchans) från `starts_per_90`, minuter, skadestatus — allt xP skalas av denna.
- **Anfall** från odds (anytime goalscorer) om tillgängligt, annars xGI-per-90-proxy.
- **Clean sheet** från odds (Clean Sheet Home/Away) om tillgängligt, annars Poisson
  på `expected_goals_conceded_per_90` + hemmaplan.
- Assist från "Player To Score or Assist"-marknaden.
- `ODDS.enabled=true`, hämtar via `ODDS_PROXY="/api/odds"`. Ingen tyst fallback:
  badge visar vilken källa som gäller; tomt/felande odds → faller synligt till xG.

## Flikar i boten
Byten (transferförslag: snabb/långsiktig/differentiell), Yolo-pick, Chips (WC/BB/TC/FH-rådgivare),
Fixtures (FDR-ticker), Kapten (rankad på xP), Momentum (transfers in/ut), Priser, Skador.

## Öppna trådar / TODO
1. **[FIXAD, ej deployad]** Gameweek-bugg: boten planerade för `current_event`
   (senast spelade) i stället för nästa. Nyaste index.html delar upp i:
   `squadGw` (trupp från senaste) vs `gw` (planering mot `is_next`).
   → Måste pushas till repot. Verifiera att headern visar rätt kommande GW efter deploy.
   Kantfall: precis efter en deadline kan `is_next` vara null en kort period.
2. Föreslagna förbättringar (ej byggda), i värdeordning:
   - Flera-omgångars-planering / solver (störst edge, mest jobb) — som FPL Review/Hub.
   - Effective ownership / template-vs-differential-märkning (billig, hög nytta).
3. Odds-anytime konverteras med rå 1/odds (bär bookmaker-marginal). Bra för *ranking*,
   inte kalibrerade sannolikheter. De-vig kan läggas till om exakta sannolikheter behövs.
4. Gammalt Vercel-projekt `project-h5be9` (gamla proxyn) kan raderas — inget pekar dit längre.

## Kända fallgropar
- API-filer måste ligga i `api/` och sluta exakt på `.js`.
- FPL:s API blockerar ibland moln-IP:n → därför proxyn med User-Agent/Referer-headers.
- Boten är en enda HTML-fil med React via Babel-standalone (ingen byggkedja).
  Vid övergång till CC/riktig toolchain: överväg att dela upp i komponenter + Vite,
  men det är valfritt — nuvarande setup fungerar och deployar utan build-steg.
