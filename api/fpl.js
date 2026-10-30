// Proxy mot FPL. Finns for att FPL svarar 403 pa nakna anrop fran moln-IP:n
// och for att webblasaren inte far anropa dem direkt (CORS).
//
// VITLISTA, INTE FRI VIDAREBEFORDRAN. Fram till 2026-10-30 byggdes url:en av
// `path` rakt ur query utan nagon kontroll, och svaret bar
// `Access-Control-Allow-Origin: *`. Uppmatt mot den skarpa deployen samma
// dag: vem som helst kunde hamta /leagues-classic/314/standings/,
// /element-summary/411/, /event-status/ och /entry/1/ genom funktionen -
// alltsa en gratis FPL-proxy pa kontots kvot, med botens IP-rykte som insats.
//
// Varden gick daremot ALDRIG att byta, vilket ocksa provades i stallet for
// att antas: tio forsok (`//evil.example/x`, `https://evil.example/`,
// `@evil.example/`, `/../../..`, `..%2F`, backslash, tabb, fragment) gav alla
// host `fantasy.premierleague.com`, eftersom basen slutar pa `/api` och allt
// som foljer darmed ar en SOKVAG. Det har var alltsa missbruk av kvoten, inte
// SSRF.
//
// Listan ar exakt de anrop boten gor, inget mer. Lagger du till ett anrop i
// index.html maste du lagga till monstret har, annars svarar proxyn 400 - och
// det ar meningen: en trasig ny vag ska synas direkt, inte bli en ny lucka.
const TILLATNA = [
  /^\/bootstrap-static\/$/,
  /^\/fixtures\/$/,
  /^\/entry\/\d{1,12}\/$/,
  /^\/entry\/\d{1,12}\/history\/$/,
  /^\/entry\/\d{1,12}\/transfers\/$/,
  /^\/entry\/\d{1,12}\/event\/\d{1,3}\/picks\/$/,
  /^\/event\/\d{1,3}\/live\/$/,
];

export default async function handler(req, res) {
  const path = req.query.path;
  // Upprepad parameter (?path=a&path=b) ger en array hos Vercel. Da ar det
  // inte ett anrop boten gor, och att plocka forsta vore en tyst gissning.
  if (typeof path !== "string") return res.status(400).json({ error: "Missing path" });
  if (!TILLATNA.some(m => m.test(path)))
    return res.status(400).json({ error: "Path not allowed" });
  const url = `https://fantasy.premierleague.com/api${path}`;
  try {
    const upstream = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://fantasy.premierleague.com/" }
    });
    if (!upstream.ok) return res.status(upstream.status).json({ error: "FPL error" });
    const data = await upstream.json();
    // Ingen Access-Control-Allow-Origin. Boten hamtar "/api/fpl" relativt och
    // ligger alltsa pa samma origin som funktionen - aven inne i iframen pa
    // wennerqvist.design, vars dokument ar vercel-adressen. Samma origin
    // fragar aldrig efter CORS, sa headern fyllde ingen funktion for boten
    // och oppnade den bara for alla andra. Skulle nagot utanfor repot anropa
    // den har vagen fran en annan doman slutar det fungera hogljutt, och da
    // ar ratt atgard en namngiven doman - inte en stjarna tillbaka.
    res.setHeader("Cache-Control", "s-maxage=60");
    return res.status(200).json(data);
  } catch (e) {
    // Detaljen hor hemma i loggen, inte i svaret. Uppmatt 2026-10-30 med
    // stubbad fetch bar `e.message` bland annat
    // "getaddrinfo ENOTFOUND fantasy.premierleague.com" och - nar FPL svarar
    // HTML i stallet for JSON - ett stycke av DERAS svarsbody rakt igenom
    // till den som anropar. Samtidigt loggades ingenting, sa den som driver
    // tjansten sag minst av alla. Precis bakvant.
    //
    // Klienten tappar inget pa bytet: `fplFetch` laser aldrig felkroppen,
    // den kastar pa `HTTP ${status}`.
    console.error("[fpl-proxy] fel for", path, "-", e);
    return res.status(500).json({ error: "Upstream request failed" });
  }
}
