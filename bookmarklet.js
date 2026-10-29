// GLENN/OS — bokmärkesknapp för att hämta din aktuella trupp
// ---------------------------------------------------------------------------
// VARFÖR DEN FINNS: FPL publicerar en omgångs trupp först EFTER dess deadline,
// så byten inför nästa omgång är osynliga publikt. Verifierat:
// /entry/{id}/event/{n}/picks/ ger 404 före deadline, /entry/{id}/transfers/
// ger tom lista, /my-team/{id}/ ger 403 från en server.
//
// Serversidig inloggning är STÄNGD och ska inte försökas igen:
// users.premierleague.com finns inte längre (NXDOMAIN) och efterföljaren
// account.premierleague.com svarar 403 på allt även med fullständiga
// webbläsarheaders. Att ta sig förbi vore att kringgå deras botskydd.
//
// I stället läser den här knappen /api/my-team/ med DIN egen inloggade session,
// i din egen webbläsare, och skickar resultatet i URL:ens fragment. Fragmentet
// skickas aldrig till någon server — truppen lämnar aldrig din webbläsare.
//
// FILEN LIGGER I REPOT, till skillnad från tidigare då koden bara fanns i en
// chatt. Den gick inte att granska, och felet nedan hade stått oupptäckt hur
// länge som helst.
//
// ÄNDRAT 2026-10-29: picks skickas HELA. Den gamla versionen gjorde
//   picks: t.picks.map(x=>({element, position, is_captain, is_vice_captain}))
// och kastade därmed selling_price. Utan det kan boten inte räkna budget rätt:
// FPL säljer till inköpspris plus halva vinsten, så dagspris ÖVERSKATTAR vad
// man har råd med och boten föreslår byten som inte går att göra. Uppmätt på
// GW8-truppen: 1,8m fel fördelat på sju spelare.
//
// Resten är medvetet oförändrat. bank skickas i tiondelar eftersom boten
// dividerar med 10, och freeTransfers skickas som limit eftersom boten räknar
// om det till limit − made ur raw. Rör inte utan att läsa index.html först.
//
// ANVÄNDNING: lägg innehållet i bookmarklet.min.txt som adress i ett bokmärke,
// gå till fantasy.premierleague.com inloggad, klicka.

(async () => {
  try {
    const j = async (u) => {
      const r = await fetch(u, { credentials: "include" });
      if (!r.ok) throw new Error(u + " gav HTTP " + r.status);
      return r.json();
    };
    // Lag-id lases ur den INLOGGADE sessionen i stallet for att hardkodas.
    // Forut stod 1036486 har, vilket gjorde knappen obrukbar for alla andra:
    // /api/my-team/<nagon annans id>/ ger 403. Nu fungerar samma bokmarke for
    // var och en som ar inloggad pa sitt eget lag.
    const me = await j("/api/me/");
    const I = me && me.player && me.player.entry;
    if (!I) throw new Error("hittade inget lag-id - ar du inloggad pa FPL?");
    const [t, b] = await Promise.all([
      j("/api/my-team/" + I + "/"),
      j("/api/bootstrap-static/"),
    ]);
    const g = (b.events.find((e) => e.is_next) || {}).id;
    if (!g) throw new Error("ingen kommande omgang");
    if (!Array.isArray(t.picks) || t.picks.length !== 15)
      throw new Error("forvantade 15 spelare, fick " + (t.picks || []).length);

    // Fail fast i stället för att skicka en nyttolast boten inte kan lita på.
    const utan = t.picks.filter((x) => typeof x.selling_price !== "number").length;
    if (utan) throw new Error(utan + " spelare saknar selling_price");

    const p = {
      // Vems lag det ar. Utan det vet boten inte vems trupp den tagit emot
      // och kan spara Richards lag under Johns nyckel.
      entry: I,
      gw: g,
      // HELA — selling_price och purchase_price foljer med
      picks: t.picks,
      bank: t.transfers && t.transfers.bank,
      freeTransfers: t.transfers && t.transfers.limit,
      raw: t.transfers,
    };
    open("https://fpl-bot-lovat.vercel.app/#team=" +
         btoa(unescape(encodeURIComponent(JSON.stringify(p)))), "_blank");
  } catch (e) {
    alert("GLENN/OS: " + e.message);
  }
})();
