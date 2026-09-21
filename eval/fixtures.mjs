// Payloads som WeekTab skulle ha byggt i olika lagen. Variationen ar poangen:
// en eval pa ett enda normalfall mater ingenting.
//
// Nycklarna speglar exakt dem WeekTab skickar. Gar de isar mater evalen en
// form som inte finns i verkligheten.
export const fixtures = [
  { namn:"normalvecka, transfer lonar sig", payload:{
    gw:5,
    kapten:{namn:"B.Fernandes", forvantadePoang:5.4, motstandare:"Fulham", hemma:false},
    // Gudmundsson bankas OCH byts bort — det ar sa lagena hanger ihop i
    // verkligheten. En fixtur dar samma spelare bade tas in i elvan och
    // saljs ar omojlig, och da mater evalen fel sak.
    elva:{formation:"3-4-3", forvantadePoangTotalt:41.2, bytIn:["Osula"], banka:["Gudmundsson"]},
    transfer:{ut:"Gudmundsson", in:"Davis", vinstIPoang:12.3, kostarFyraPoang:false,
              nettoIPoang:12.3, horisont:"fem omgångar"},
    friaTransfers:1, skadade:[], osakra:[{namn:"Cash", speltidProcent:45}],
    banken:{spelbara:1, spelarInte:0, totalt:4}, chipsKvar:3,
    templateOverlapp:{dinaSpelareIMallelvan:6, avTotalt:11} }},

  { namn:"skador och tunn bank", payload:{
    gw:12,
    kapten:{namn:"Haaland", forvantadePoang:7.1, motstandare:"Burnley", hemma:true},
    elva:{formation:"4-4-2", forvantadePoangTotalt:38.6, bytIn:[], banka:[]},
    transfer:{gorIngenTransfer:true, bastaAlternativetVinstIPoang:0.4},
    friaTransfers:2,
    skadade:[{namn:"Saka", notis:"Knäskada - förväntas åter om 3 veckor"}],
    osakra:[{namn:"Rogers", speltidProcent:60},{namn:"Janelt", speltidProcent:35}],
    banken:{spelbara:0, spelarInte:2, totalt:4}, chipsKvar:1,
    templateOverlapp:{dinaSpelareIMallelvan:9, avTotalt:11} }},

  { namn:"transfer kostar fyra poang", payload:{
    gw:22,
    kapten:{namn:"Salah", forvantadePoang:6.8, motstandare:"Everton", hemma:true},
    elva:{formation:"3-5-2", forvantadePoangTotalt:44.9, bytIn:["Mbeumo"], banka:["Wissa"]},
    transfer:{ut:"Wissa", in:"Mbeumo", vinstIPoang:5.2, kostarFyraPoang:true,
              nettoIPoang:1.2, horisont:"fyra omgångar"},
    friaTransfers:0, skadade:[], osakra:[],
    banken:{spelbara:3, spelarInte:0, totalt:4}, chipsKvar:0,
    templateOverlapp:{dinaSpelareIMallelvan:4, avTotalt:11} }},

  { namn:"tomt lage, inget att gora", payload:{
    gw:30,
    kapten:{namn:"Palmer", forvantadePoang:5.9, motstandare:"Brentford", hemma:false},
    elva:{formation:"4-3-3", forvantadePoangTotalt:40.1, bytIn:[], banka:[]},
    transfer:{gorIngenTransfer:true, bastaAlternativetVinstIPoang:null},
    friaTransfers:1, skadade:[], osakra:[],
    banken:{spelbara:4, spelarInte:0, totalt:4}, chipsKvar:2,
    templateOverlapp:{dinaSpelareIMallelvan:7, avTotalt:11} }},
];
