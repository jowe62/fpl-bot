// Forankringskontroll for "Veckans brief".
//
// Pastaendet som hela genAI-lagret vilar pa: spraakmodellen raknar inget och
// hittar inte pa nagon spelare. Den har filen ar inte en asikt om det — den
// mater det.
//
// Tva egenskaper kontrolleras, bada mekaniskt avgorbara:
//
//   1. SIFFROR. Varje tal i briefen maste finnas i payloaden. Modellen far
//      inte rakna fram nya varden, inte ens korrekta — en summa den rakinat
//      sjalv ar per definition oforankrad.
//   2. NAMN. Varje FPL-namn i briefen maste finnas i payloaden. Kontrollen
//      gors mot HELA ligans spelar- och lagregister: namns en spelare som
//      finns i Premier League men inte i payloaden ar det pahittat.
//
// MEDVETEN BEGRANSNING: kontrollen fangar pahittade tal och pahittade namn.
// Den fangar INTE ett falskt pastaende om en forankrad entitet ("Haaland ar
// skadad" nar Haaland finns i payloaden men inte bland skadade). Det kravde
// semantisk kontroll. Sag aldrig att den tacker mer an den gor.

const SIFFRA = /\d+(?:[.,]\d+)?/g;

// Svenska raknord som modellen kan skriva i bokstaver i stallet for siffror.
//
// UTESLUTNA, med skal:
//   "en"/"ett" — artiklar i svenskan, skulle ge falsklarm i var och varannan
//                mening.
//   "elva"     — i svenskt fotbollssprak betyder "elva" startelvan, inte talet
//                11. Sjalvtestet fangade detta: kontrollen underkande en helt
//                korrekt brief for frasen "hogst i din elva". Priset ar att
//                talet 11 inte kontrolleras nar det skrivs med bokstaver.
const RAKNEORD = {
  tva:2, "två":2, tre:3, fyra:4, fem:5, sex:6, sju:7, atta:8, "åtta":8,
  nio:9, tio:10, tolv:12,
};

export function normNum(v){
  const n = Number(String(v).replace(",", "."));
  if(!Number.isFinite(n)) return null;
  // 12.0 och 12 ar samma pastaende; 12.30 och 12.3 likasa.
  return String(Math.round(n*100)/100);
}

// Alla tal som payloaden faktiskt innehaller — bade som varden och inbakade
// i strangar ("fem omgangar").
export function allowedNumbers(payload){
  const out = new Set();
  const add = v => { const n = normNum(v); if(n!==null) out.add(n); };
  (function walk(v){
    if(v===null||v===undefined) return;
    if(typeof v === "number") return add(v);
    if(typeof v === "string"){
      for(const m of v.matchAll(SIFFRA)) add(m[0]);
      for(const [ord,tal] of Object.entries(RAKNEORD))
        if(new RegExp(`\\b${ord}\\b`,"i").test(v)) add(tal);
      return;
    }
    if(Array.isArray(v)) return v.forEach(walk);
    if(typeof v === "object") return Object.values(v).forEach(walk);
  })(payload);
  return out;
}

// Alla tal briefen pastar. Bade siffror och utskrivna raknord.
export function numbersIn(text){
  const found = [];
  for(const m of text.matchAll(SIFFRA)) found.push({ord:m[0], tal:normNum(m[0])});
  for(const [ord,tal] of Object.entries(RAKNEORD))
    if(new RegExp(`\\b${ord}\\b`,"i").test(text)) found.push({ord, tal:normNum(tal)});
  return found.filter(f=>f.tal!==null);
}

export function namesInPayload(payload){
  const out = new Set();
  (function walk(v){
    if(typeof v === "string") return out.add(v.toLowerCase());
    if(Array.isArray(v)) return v.forEach(walk);
    if(v && typeof v === "object") return Object.values(v).forEach(walk);
  })(payload);
  return out;
}

// universe = varje spelarnamn och lagnamn som finns i Premier League.
export function checkBrief({text, payload, universe}){
  const tillatnaTal = allowedNumbers(payload);
  const payloadText = [...namesInPayload(payload)].join(" | ");
  const brott = [];

  for(const {ord, tal} of numbersIn(text)){
    if(!tillatnaTal.has(tal))
      brott.push({typ:"siffra", varde:ord, varfor:`${ord} finns inte i payloaden`});
  }

  for(const namn of universe){
    const re = new RegExp(`(?<![\\p{L}])${namn.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}(?![\\p{L}])`,"iu");
    if(re.test(text) && !payloadText.includes(namn.toLowerCase()))
      brott.push({typ:"namn", varde:namn, varfor:`${namn} finns i Premier League men inte i payloaden`});
  }

  return {ok: brott.length===0, brott, antalTal: tillatnaTal.size};
}
