# GLENN/OS

En Fantasy Premier League-bot jag byggt åt mig själv. Den gör i stort sett det
premiumsajterna gör, fast anpassad för ett lag och utan prenumeration.

Kärnan är en xP-modell, alltså förväntade poäng per spelare. Den bygger på
sannolikheten att spelaren faktiskt spelar, xG och xA per 90 minuter,
sannolikheten för hållen nolla, och om matchen spelas hemma eller borta.
Ovanpå ligger riktiga bookmakerodds på målskytt och hållen nolla. Modellen
fattar besluten: kapten, byten, startelva, när chips ska spelas.

## Varför den är byggd som den är

Jag ville kunna lita på den. En bot som gissar men låter säker är värre än
ingen bot, för då fattar man dåliga beslut med självförtroende.

Två regler styr allt annat i koden. Den första är att det inte finns några
tysta reservvägar. Om odds saknas för ett lag så säger gränssnittet det rakt
ut i stället för att i smyg falla tillbaka på xG-proxyn. Om ett spelarnamn från
bookmakern inte går att matcha mot FPL:s register rapporteras det som omatchat,
i stället för att gissa på närmaste träff. Den andra regeln är att varje
funktion som vilar på tunn data säger hur tunn den är.

## Slår den en gissning?

Det är den enda frågan som betyder något, och den går att svara på. Boten
sparar sin egen prognos före varje deadline och jämför mot utfallet efteråt.

Snittfel per spelare och omgång, GW2 till GW8:

| Metod | Fel |
|---|---|
| Modellen | 2,49 |
| Gissa alltid 2 poäng | 3,06 |
| Spelarens snitt hittills | 3,60 |
| Förra omgångens poäng | 3,68 |
| Alltid noll | 3,99 |

Modellen slår varje naiv gissning, 19 procent bättre än den bästa av dem. Att
"gissa 2" är svårast att slå är ingen slump. De flesta spelare landar kring två
poäng för att ha startat matchen.

Den siffran står nu i gränssnittet bredvid modellens eget fel, räknad per
omgång över exakt samma spelare. Förut stod det bara att felet var rimligt.
Rimligt mot vad, stod det inte.

## Vad jag tog bort när jag mätte

Modellen vägde tidigare in FPL:s egen svårighetsgrad, FDR, på båda sidor. Jag
mätte den mot bookmakerns marginalkalibrerade odds och tog bort den från halva
modellen.

På anfallssidan, 258 spelare med minst 180 spelade minuter, var FDR sämre än
att inte justera för motståndet alls. Att i stället använda lagens egen
försvarsdata hjälpte inte heller. Det som hjälpte var hemma eller borta, och
bara det. Felet föll från 0,2297 till 0,2085.

På clean sheet-sidan hjälper FDR tvärtom. Utan den blir felet 31 procent
större, och dagens konfiguration slog alla sex alternativ jag provade. Där
rörde jag ingenting.

Det är inte lika motsägelsefullt som det låter. FDR är i grunden ett omdöme om
hur svår matchen är, och det hänger ihop med hur mycket ett lag släpper in. För
en enskild anfallares avkastning dominerar spelarens eget xG och xA, och då
blir FDR brus ovanpå.

Konsekvensen går längre än en konstant. Fixturöversikten färgades av FDR och
färgas nu av varje spelares egen xP jämfört med hans eget snitt. Riskbetyget i
bytesförslagen kom ur FDR och kommer nu ur speltid. Ett omdöme om motståndet
som inte går att belägga ska inte stå i gränssnittet som om det vore ett mått.

## Vigg

Odds går inte att läsa som sannolikheter rakt av. Summan av 1 delat med oddsen
överstiger alltid 1, eftersom bookmakern lagt in sin marginal. Att bara
normalisera bort överskottet fördelar felet jämnt, vilket är fel. Marginalen
sitter tyngre på långskotten.

Boten kalibrerar i stället med en potenstransform per lag, där exponenten löses
ut så att summan landar där den ska. Exponenterna hamnar runt 1,45 till 1,75.
Utan det steget blir varje anfallare för bra på papperet, och kaptensvalet med
dem.

## Språkmodellen får inte räkna

Det finns ett genAI-lager. Det skriver "Veckans brief", alltså veckans beslut i
löpande text för den som inte vill läsa tabeller.

Modellen räknar ingenting. Den får en färdig payload med beslut som redan är
fattade och siffror som redan är uträknade, och dess enda jobb är att formulera
om dem. Den får inte nämna en spelare, ett lag eller en klubbtillhörighet som
inte står i underlaget. Den får inte räkna ut en summa, ens en korrekt sådan.

Det låter strängt. Det är avsikten. En språkmodell som får resonera fritt om FPL
hittar på skador och poäng, och då rasar hela poängen med boten.

I gränssnittet finns en knapp som fäller ut exakt den JSON modellen fick. Man
ska kunna kontrollera varje siffra i texten mot källan själv, utan att ta mitt
ord för det.

## Evalen

Ett påstående om att modellen inte hittar på är värdelöst om det bara står i en
systemprompt. `eval/` mäter det.

Kontrollen har två delar. Varje tal i briefen måste finnas i payloaden. Varje
FPL-namn i briefen måste finnas i payloaden, och kontrollen görs mot hela ligans
register på knappt 700 spelare och lag. Nämner modellen en spelare som finns i
Premier League men inte i truppen är det per definition påhittat, även om det
låter rimligt.

Kontrollanten testas separat, utan API-nyckel, mot kända bra och kända trasiga
texter. Det testet fångade en bugg i kontrollanten själv: på svenska betyder
"elva" startelvan, inte talet 11, och kontrollen underkände en helt korrekt
brief. Ett mätinstrument som inte är testat är en gissning med sifferpynt.

Eftersom modellen är icke-deterministisk kör evalen flera gånger per fall och
rapporterar en andel. Det avgjorde också modellvalet:

| Modell | Förankrade briefs | Kostnad per brief |
|---|---|---|
| Haiku 4.5 | 9 av 12 | ca 2 öre |
| Sonnet 5 | 12 av 12 | ca 5 öre |

Haiku skrev "de nio spelare du byter ut" i en omgång utan byten, och rundade
12,3 till "tolv". Den skrev också Chelsea om en spelare vars klubb inte stod i
underlaget. Det är farligt just för att det oftast stämmer, ända tills någon
byter klubb.

Tolv av tolv betyder inga fel på tolv försök. Det betyder inte att frekvensen
är noll.

## Vad den inte gör

Förankringskontrollen fångar påhittade tal och påhittade namn. Den fångar inte
ett falskt påstående om något som finns i underlaget. Skulle modellen skriva att
en spelare är skadad när han står listad som frisk går det igenom.

Modellen flaggar inte heller motsägelser i indatan. Får den något ologiskt
skriver den sig förbi det i stället för att säga ifrån.

Boten blir inte bättre av sig själv. Språkmodellen lär sig inget mellan anrop.
Det som mognar är xP-modellens kalibrering, och den behöver spelade omgångar.

## Stack

Ingen byggkedja. `index.html` är hela frontenden, React via Babel i webbläsaren.
Bakom ligger fem serverlösa funktioner på Vercel.

| Fil | Vad den gör |
|---|---|
| `api/fpl.js` | Proxy mot FPL:s API |
| `api/odds.js` | Odds, namnmatchning, viggkalibrering |
| `api/league.js` | Kompisligan, positioner per omgång |
| `api/elite.js` | Stickprov ur topp 50 globalt |
| `api/briefing.js` | Veckans brief |
| `eval/` | Förankringskontroll och dess självtest |

Alla nycklar ligger server-side. Inget hemligt når webbläsaren.

## Köra evalen

```bash
node eval/grounding.test.mjs      # testar kontrollanten, ingen nyckel behövs
N=5 node eval/run-brief-eval.mjs  # kör skarpa briefs och mäter andelen
```

Den senare avslutar med kod 1 om någon brief är oförankrad.
