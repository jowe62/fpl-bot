// Sjalvtest av forankringskontrollen. Kraver ingen API-nyckel.
// Ett matinstrument som inte ar testat ar en gissning med sifferpynt.
import { checkBrief } from "./grounding.mjs";

const payload = {
  gw:5,
  kapten:{namn:"B.Fernandes", xp:5.4, motstandare:"Fulham", hemma:false},
  elva:{formation:"3-4-3", xpTotalt:41.2, bytIn:["Gudmundsson"], banka:["Osula"]},
  transfer:{ut:"Gudmundsson", in:"Davis", vinstXp:12.3, kostarFyra:false,
            nettoXp:12.3, horisont:"fem omgångar"},
  friaTransfers:1,
  skadade:[],
  osakra:[{namn:"Cash", speltidProcent:45}],
  bank:{spelbara:1, spelarInte:0, totalt:4},
  chipsKvar:3,
  templateOverlapp:6,
};

// Ett urval ur Premier League-registret: nagra finns i payloaden, andra inte.
const universe = ["B.Fernandes","Gudmundsson","Davis","Osula","Cash","Fulham",
                  "Salah","Haaland","Saka","Arsenal","Liverpool","Chelsea"];

const fall = [
  { namn:"forankrad brief", vantat:true, text:
`Sätt kaptensbandet på B.Fernandes den här omgången. Han landar på 5,4 xP, högst
i din elva, och möter Fulham på bortaplan.

Byt Gudmundsson mot Davis. Det ger 12,3 xP över fem omgångar och ryms i din
fria transfer, så det kostar dig ingenting. Din uppställning i 3-4-3 landar på
41,2 xP totalt när Gudmundsson går in och Osula tar plats på bänken.

Cash är osäker med 45% speltid. Du har 3 chips kvar och 6 av dina spelare finns
i template-elvan.` },

  { namn:"pahittad siffra", vantat:false, text:
`B.Fernandes ger 5,4 xP. Din elva landar på 41,2 xP, vilket är 13,7 över snittet
i din liga.` },

  { namn:"pahittad spelare", vantat:false, text:
`Sätt bandet på B.Fernandes med 5,4 xP. Salah hade varit ett alternativ.` },

  { namn:"pahittat lag", vantat:false, text:
`B.Fernandes möter Fulham. Arsenal har den bästa matchen den här omgången.` },

  { namn:"egenraknad summa (korrekt men oforankrad)", vantat:false, text:
`B.Fernandes ger 5,4 xP av lagets 41,2, alltså 13,1% av totalen.` },
];

let fel = 0;
for(const f of fall){
  const r = checkBrief({text:f.text, payload, universe});
  const godkant = r.ok === f.vantat;
  if(!godkant) fel++;
  console.log(`${godkant?"OK  ":"FEL "} ${f.namn.padEnd(42)} ok=${r.ok} (vantat ${f.vantat})`);
  for(const b of r.brott) console.log(`        -> ${b.typ}: ${b.varfor}`);
}
console.log(fel===0 ? "\nAlla fall som vantat." : `\n${fel} fall avvek.`);
process.exit(fel===0?0:1);
