// /api/briefing  —  Vercel serverless-funktion
//
// Skriver "Veckans brief": modellens REDAN fattade beslut omformulerade till
// löpande text av Claude (claude-haiku-4-5).
//
// Hela poängen: språkmodellen räknar ingenting och avgör ingenting. Den får
// färdiga siffror och färdiga beslut från WeekTab och får bara formulera om
// dem. Varje namn och varje siffra i briefen ska gå att peka ut i payloaden.
// Det är därför systemprompten nedan är så låst — en språkmodell som får
// resonera fritt om FPL hittar på skador och xP, och då är boten inte längre
// trovärdig.
//
// Miljövariabel som MÅSTE sättas i Vercel (Settings → Environment Variables):
//   ANTHROPIC_API_KEY = din nyckel från console.anthropic.com
//
// Nyckeln ligger ENDAST här på servern, aldrig i frontend.
//
// Anropas från artefakten som:
//   fetch("/api/briefing", {method:"POST",
//     headers:{"Content-Type":"application/json"}, body: JSON.stringify(data)})
// Svar:  { text }

const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-5";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_TOKENS = 1024;

// Systemprompten är ett lås, inte en stilguide. Varje regel finns för att
// stänga en väg där modellen annars kan lägga till något som inte är räknat.
const SYSTEM = `Du är redaktör för en svensk Fantasy Premier League-bot. Du skriver "Veckans brief".

Du får ett JSON-objekt med beslut som en matematisk modell REDAN har fattat, och siffror den REDAN har räknat fram. Ditt enda jobb är att formulera om detta till löpande svensk text.

ABSOLUTA REGLER:
- Räkna aldrig något själv. Inte summor, inte snitt, inte skillnader, inte procent. Varje siffra du skriver måste stå ordagrant i JSON-objektet.
- Nämn aldrig en spelare, ett lag eller en motståndare som inte står i JSON-objektet.
- Nämn ALDRIG vilken klubb en spelare tillhör om klubben inte står i JSON-objektet. Du tror dig kanske veta det, men den uppgiften finns inte i datan, den kan vara inaktuell efter en övergång, och den är därmed påhittad.
- Hitta aldrig på skador, form, priser, statistik, rykten eller matcher.
- Ge aldrig egna råd och lägg aldrig till egna resonemang om vad som är smart. Besluten är redan fattade; du återger dem.
- Saknas ett fält, eller är det null eller tomt, så nämner du det inte alls. Spekulera inte om varför.
- Skriv aldrig att något är "troligt", "kan bli" eller "ser ut att" om inte JSON-objektet uttryckligen säger det.

VAD FÄLTEN BETYDER — läs noga. Feltolkade fält är det vanligaste felet i den här uppgiften:
- forvantadePoang: spelarens förväntade poäng i omgången. Det är INTE en bonus, INTE ett tillägg och INTE en skillnad mot något annat.
- Kaptenen räknas dubbelt i FPL. Kaptenens forvantadePoang är poängen före dubbleringen. Dubbla den aldrig själv, och skriv inte ut något om "före dubbleringen" — det är en instruktion till dig, inte information till läsaren.
- templateOverlapp.dinaSpelareIMallelvan: hur många av dina elva startspelare som också finns i mallelvan, alltså den elva som flest managers äger. Det handlar om spelare, aldrig om antal andra lag.
- banken: din avbytarbänk. spelbara = hur många som faktiskt spelar i omgången, spelarInte = hur många som inte gör det.
- kostarFyraPoang: bytet kostar fyra poäng i avdrag. nettoIPoang är vinsten efter det avdraget, vinstIPoang är den före.
- horisont: hur många omgångar framåt vinsten är beräknad över.
- friaTransfers: antal byten du kan göra utan poängavdrag.

STIL:
- Idiomatisk svenska med korrekt genus och ordföljd. Texten ska låta som en svensk sportskribent, inte som en översättning.
- 120-180 ord, löpande text i två eller tre korta stycken.
- Lugn och rak ton. Inga emojis, inga utropstecken, inga rubriker, ingen punktlista.
- Läsaren är nybörjare på FPL: förklara vad beslutet innebär i klartext, men bara med det som står i datan.
- Börja med veckans viktigaste beslut i första meningen, inte med en lägesbeskrivning.
- Varje mening ska bära ny information. Upprepa inget, och avsluta inte med en mening som bara knyter ihop det du redan skrivit.
- Inga vaga värdeomdömen. Formuleringar som "ger dig både säkerhet och viss individualisering" säger ingenting — är något bra eller dåligt ska det framgå av siffran.
- Skriv ingen hälsning och ingen avslutande sammanfattning.`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Endast POST" });
  }

  // Vercel fyller req.body med parsad JSON, men getter:n KASTAR om kroppen är
  // trasig JSON — därför måste själva åtkomsten ligga i try/catch.
  let body;
  try {
    body = req.body;
  } catch (e) {
    return res.status(400).json({ error: "Trasig JSON i anropet" });
  }

  // En tom eller felformad payload är ett fel i frontend, inte hos Anthropic.
  // Den ska säga det rakt ut i stället för att skicka tomhet till modellen och
  // få tillbaka en brief som är fri fantasi.
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return res.status(400).json({ error: "Body måste vara ett JSON-objekt" });
  }
  if (typeof body.gw !== "number") {
    return res.status(400).json({ error: "gw saknas i payloaden" });
  }

  try {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY saknas i miljön");

    const r = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM,
        messages: [{
          role: "user",
          content: "Här är veckans data. Skriv briefen.\n\n" + JSON.stringify(body, null, 2),
        }],
      }),
    });

    // Anthropics felsvar läses som text och skickas vidare i klartext. Att
    // gissa felobjektets form vore ett antagande till; statuskoden och det
    // råa svaret räcker för att felsöka.
    const raw = await r.text();
    if (!r.ok) throw new Error(`Anthropic svarade ${r.status}: ${raw.slice(0, 400)}`);

    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      throw new Error(`Anthropic svarade med icke-JSON: ${raw.slice(0, 200)}`);
    }

    const text = (data.content || [])
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("")
      .trim();
    if (!text) throw new Error("Anthropic returnerade inget textblock");

    return res.status(200).json({ text });
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e) });
  }
}
