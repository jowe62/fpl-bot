# GLENN/OS — granskning 2026-10-30

Inga filer i appen ändrade. Detta är enbart utredning.

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
| **B1** | Bugg / modell | **Kritisk** | Bench Boost överskattas med 40–96 %. Chipets värde sätts till hela bänkens xP, men utan chipet ger auto-bytena redan en stor del av den poängen när en startspelare uteblir. | `index.html:1178` `const bb=bench.reduce((s,p)=>s+xp(p),0)` med kommentaren "alltså exakt bänkens xP". Kört: frisk trupp bb 13,53 xP, förväntat antal uteblivna startspelare 1,40, bänkspelares xP när han spelar 3,82 → auto-byten värda ca 5,36 xP, alltså **40 %** av det chipet påstås ge. Med tre skadade i truppen: 96 %. Facit-fliken bekräftar att auto-byten faktiskt utlöses ("1 startspelare uteblev, så auto-bytena var i spel"). | Dra av auto-bytenas väntevärde: `bb = bänkens xP − Σ(1−xMins) över startelvan × villkorad bänk-xP`, med hänsyn till att målvakt bara ersätts av målvakt. | **Ja**, kört |
| **B2** | Modell / saknad funktion | **Hög** | Vice kapten finns inte i någon uträkning. Modellen dubblar kaptenen utan att väga in att vice tar över om kaptenen inte spelar, och boten rekommenderar aldrig en vice. | `isVice` förekommer på exakt två ställen, `index.html:1734` och `1784`, båda rent visuella. Kaptensvärdet är `xi.total + kapten` utan vice-term. Kört: Haaland speltid 89 %, vices villkorade xP 4,59 → modellen missar ca **0,45 xP** och kan välja fel kapten när två kandidater ligger nära men har olika startsannolikhet. | Lägg till vice-termen i kaptensvärdet och ranka vice separat i Kapten-fliken. Gäller även Triple Captain, där vice ärver multiplikatorn. | **Ja**, kört |
| **B3** | Bugg | Medel | Free Hits blankvärde blir alltid 0 i den omgång man faktiskt skulle spela chipet. | `index.html:1183-1184`: spelare som saknar match i `g` värderas med `estimateXpAt(p,fm,**gw**,false)`. När `g===gw` returnerar den funktionen 0, eftersom `estimateXpAt` har `if(!fixtures.length) return {xp:0}` (rad 528). Kört: en spelare utan match i `gw` ger xP 0. | Värdera blanks mot ett generellt mått på spelarens värde, till exempel `estimateXpLong`, i stället för en specifik omgång som kan vara samma blanka omgång. | **Ja**, kört |
| **B4** | Bugg / tillstånd | Medel | Kastar `buildRecs`, fastnar Byten-fliken på "Analyserar..." för alltid och felet försvinner i konsolen. | `index.html:3679-3686`: `setAnalyzing(true)` följs av ett `setTimeout` utan `try/catch`, där `setAnalyzing(false)` ligger **efter** anropet som kan kasta. `buildRecs` kastar numera om säljpriser saknas (rad ~1385). Grinden ligger i UI:t, kastet i modellen — två olika ställen. `SquadSuggestion.bygg()` gör rätt och fångar, så mönstret är inkonsekvent i samma fil. | `try/catch` runt kroppen, `setAnalyzing(false)` i `finally`, och visa felet som `SquadSuggestion` redan gör. | **Ja**, lästa kodvägar |
| **B5** | Tillgänglighet | Medel | `T.dim` används för text ned till 10 px och klarar inte WCAG AA. | Uträknat kontrastförhållande: `T.dim` (#6C7684) mot kort (#161A21) = **3,79:1**, mot bakgrund = 4,33:1. AA kräver 4,5:1 för brödtext. Används i `statLbl` 10 px (rad 1615), `secTitle` 10 px (1663), `briefIntro` 13 px (1625), `staleNote` 12 px (1635). Knappens avstängda läge använder `T.disabled` (#4E5765) = **2,39:1**, under även 3:1-gränsen för stor text. | Lyft `dim` till minst #7C8694 (ca 4,6:1) eller använd `mut` (7,96:1) för all text under 18 px. Avstängd knapp behöver egen färg. | **Ja**, uträknat |
| **B6** | UX | Medel | Deadline visas aldrig, trots att hela botens syfte är beslut före deadline. | `grep -c deadline_time index.html` → **0**. Fältet finns i bootstrap och används i `api/odds.js` men läses aldrig i klienten. Fredagskollen säger "sedan 29 okt. 20:57" men aldrig hur lång tid som är kvar. | Visa deadline och nedräkning i nyckeltalsraden, intill "NÄSTA OMGÅNG". |  **Ja**, grep |
| **B7** | Kod | Medel | `useEffect` för iframe-höjd saknar beroendelista och river upp en `ResizeObserver` vid varje omrendering. | `index.html:3562-3570`, blocket slutar på `});` och inte `},[]);`. De fem andra `useEffect` i filen har alla `[]`. Just den här komponenten har orsakat en höjdåterkopplingsloop i iframen tidigare. | `},[])`. Observern behöver bara skapas en gång. | **Ja**, läst |
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
| Byten | Femveckorsplan plus tre enskilda alternativ | Ja. Planen och alternativen räknar **olika** saker, vilket framgår av rubrikerna. Risk för låsning (**B4**) |
| Fixtures | xP per omgång, färg relativt spelarens eget snitt | Ja, matchar riggen |
| Chips | Vad varje chip är värt | **Nej.** Bench Boost är fel (**B1**), Free Hits horisontvärde är fel (**B3**), förbrukade chip visar värde (**B12**) |
| Ligan | Serietabell räknad ur matchresultat | **Ja, exakt.** Oberoende uträknad: MCI 8-7-0-1, 20-9, 21 p. Botens påstående att FPL:s egen tabelldata är tom är verifierat: `played/win/draw/loss/points` är noll för alla 20 lag |
| Eliten | Effektivt ägande ur topp 50 | Formeln håller: Haaland 174 % = ägande plus kaptensandel, vilket är rätt definition |
| Facit | Jämför prognos mot utfall | Ja. Baslinjen finns med, vilket är rätt. Hårdkodad bänkstorlek (**B14**) |
| Analys | Poänguppdelning och xP-kurvor | Ja |
| Skador | Flaggade spelare | Ja, men den är tom medan Veckan samtidigt har en nyhetspanel med skadenotiser. Två ställen för samma sak |

---

## Noterat, inte buggar

- **Felhanteringen är genomgående bra.** `fplFetch` kastar med status och sökväg,
  `App` har riktiga lägen för laddning och fel, och felvyn skiljer 403 från
  övrigt. Det är ovanligt gjort.
- **Inga tysta reserver i datavägarna.** Saknas säljpriser räknas ingenting, och
  gränssnittet säger varför. Odds som inte går att de-vigga slopas i stället för
  att skickas vidare råa. Det följer projektets egen regel.
- **Modellen mäts mot en baslinje** i Facit-fliken, vilket är rätt sätt.

## Att ta ställning till

**B1 och B2 är de enda som flyttar ett beslut.** B1 får Bench Boost att se
bättre ut än det är, och B2 gör att kaptensvalet saknar en term som är värd
knappt en halv poäng och växer när kaptenen är osäker. Resten är hygien.

Vice kapten är dessutom uttryckligen önskad som funktion, så **B2 är både en
bugg och den funktionen** — de bör byggas i samma ändring.
