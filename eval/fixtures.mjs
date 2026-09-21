// Payloads som WeekTab skulle ha byggt i olika lagen. Variationen ar poangen:
// en eval pa ett enda normalfall mater ingenting.
export const fixtures = [
  { namn:"normalvecka, transfer lonar sig", payload:{
    gw:5,
    kapten:{namn:"B.Fernandes", xp:5.4, motstandare:"Fulham", hemma:false},
    // Gudmundsson bankas OCH byts bort — det ar sa lagena hanger ihop i
    // verkligheten. En fixtur dar samma spelare bade tas in i elvan och
    // saljs ar omojlig, och da mater evalen fel sak.
    elva:{formation:"3-4-3", xpTotalt:41.2, bytIn:["Osula"], banka:["Gudmundsson"]},
    transfer:{ut:"Gudmundsson", in:"Davis", vinstXp:12.3, kostarFyra:false,
              nettoXp:12.3, horisont:"fem omgångar"},
    friaTransfers:1, skadade:[], osakra:[{namn:"Cash", speltidProcent:45}],
    bank:{spelbara:1, spelarInte:0, totalt:4}, chipsKvar:3, templateOverlapp:6 }},

  { namn:"skador och tunn bank", payload:{
    gw:12,
    kapten:{namn:"Haaland", xp:7.1, motstandare:"Burnley", hemma:true},
    elva:{formation:"4-4-2", xpTotalt:38.6, bytIn:[], banka:[]},
    transfer:{gorIngenTransfer:true, bastaAlternativetVinstXp:0.4},
    friaTransfers:2,
    skadade:[{namn:"Saka", notis:"Knäskada - förväntas åter om 3 veckor"}],
    osakra:[{namn:"Rogers", speltidProcent:60},{namn:"Janelt", speltidProcent:35}],
    bank:{spelbara:0, spelarInte:2, totalt:4}, chipsKvar:1, templateOverlapp:9 }},

  { namn:"transfer kostar fyra poang", payload:{
    gw:22,
    kapten:{namn:"Salah", xp:6.8, motstandare:"Everton", hemma:true},
    elva:{formation:"3-5-2", xpTotalt:44.9, bytIn:["Mbeumo"], banka:["Wissa"]},
    transfer:{ut:"Wissa", in:"Mbeumo", vinstXp:5.2, kostarFyra:true,
              nettoXp:1.2, horisont:"fyra omgångar"},
    friaTransfers:0, skadade:[], osakra:[],
    bank:{spelbara:3, spelarInte:0, totalt:4}, chipsKvar:0, templateOverlapp:4 }},

  { namn:"tomt lage, inget att gora", payload:{
    gw:30,
    kapten:{namn:"Palmer", xp:5.9, motstandare:"Brentford", hemma:false},
    elva:{formation:"4-3-3", xpTotalt:40.1, bytIn:[], banka:[]},
    transfer:{gorIngenTransfer:true, bastaAlternativetVinstXp:null},
    friaTransfers:1, skadade:[], osakra:[],
    bank:{spelbara:4, spelarInte:0, totalt:4}, chipsKvar:2, templateOverlapp:7 }},
];
