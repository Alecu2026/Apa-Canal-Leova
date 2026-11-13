/**
 * "Tabelul 1C": avizele de plată din noul serviciu 1C (Leova, `…/hs/infoCec/info/apl/<dată>`), un rând per abonat și lună,
 * cu TOATE datele din răspuns — ca cei de la 1C să poată verifica singuri, într-un tabel filtrabil, că ce e în PWA
 * corespunde cu ce au trimis ei.
 *
 * Serviciul întoarce o listă plată de avize pentru luna din dată (nu 6 tabele legate prin UID, ca exportul vechi):
 * fiecare aviz are soldurile pe servicii (apă, canalizare, gunoi, TO, apartament), plățile și recalculările lunii,
 * cotele, indicii vechi / noi ai contorului, numărul contorului și al sigiliului. NU are telefon, UID, IDNO, consumatori
 * sau istoric de citiri — acestea rămân în aplicație (vezi apa-canal-import.ts, regula „un câmp lipsă nu șterge nimic”).
 *
 * Modul pur (fără server-only / alias-uri): îl pot folosi și scripturile, nu doar aplicația.
 */

export type ColType = "text" | "num" | "date";

export type OneCColumn = {
  key: string;
  label: string;
  /** Numele câmpului din răspunsul 1C (pentru cei de la 1C, ca să recunoască sursa). */
  src: string;
  type: ColType;
  /** Lățime orientativă (px) în tabel. */
  w: number;
};

/** Coloanele tabelului comun, în ordinea afișării. `key` = câmpul din modelul OneCRecord. */
export const ONEC_COLUMNS: OneCColumn[] = [
  { key: "uid", label: "ID înregistrare", src: "AbonentCod + Data", type: "text", w: 150 },
  { key: "nume", label: "Abonat", src: "Abonent", type: "text", w: 220 },
  { key: "contPersonal", label: "Cod abonat", src: "AbonentCod", type: "text", w: 110 },
  { key: "strada", label: "Stradă / localitate", src: "Strada", type: "text", w: 220 },
  { key: "casa", label: "Casa", src: "Casa", type: "text", w: 70 },
  { key: "apartament", label: "Nr. apartament", src: "NrApartament", type: "text", w: 100 },
  { key: "dataDoc", label: "Data aviz", src: "Data", type: "date", w: 110 },
  { key: "lunaViitoare", label: "Luna următoare", src: "LunaViitoare", type: "text", w: 120 },
  { key: "calculat", label: "Total calculat", src: "Total", type: "num", w: 100 },
  { key: "soldInit", label: "Total sold inițial", src: "TotalSoldInit", type: "num", w: 110 },
  { key: "platit", label: "Total plătit", src: "TotalPlatit", type: "num", w: 100 },
  { key: "recalc", label: "Total recalcul", src: "TotalRecalc", type: "num", w: 100 },
  { key: "deAchitat", label: "Total spre plată", src: "TotalSprePlata", type: "num", w: 110 },
  { key: "datorieAvans", label: "Datorie / avans (sold − plătit)", src: "TotalSoldInit − TotalPlatit", type: "num", w: 130 },
  { key: "apaSoldInit", label: "Apă: sold inițial", src: "ApaSoldInit", type: "num", w: 100 },
  { key: "apaPlatit", label: "Apă: plătit", src: "ApaPlatit", type: "num", w: 90 },
  { key: "apaRecalc", label: "Apă: recalcul", src: "ApaRecalc", type: "num", w: 90 },
  { key: "apaSuma", label: "Apă: calculat", src: "ApaUdare", type: "num", w: 90 },
  { key: "apaSprePlata", label: "Apă: spre plată", src: "ApaSprePlata", type: "num", w: 100 },
  { key: "apaTarif", label: "Apă: cotă (contor rece)", src: "CotaContorRece", type: "num", w: 110 },
  { key: "canalSoldInit", label: "Canal: sold inițial", src: "CanalizareSoldInit", type: "num", w: 100 },
  { key: "canalPlatit", label: "Canal: plătit", src: "CanalizarePlatit", type: "num", w: 90 },
  { key: "canalRecalc", label: "Canal: recalcul", src: "CanalizareRecalc", type: "num", w: 90 },
  { key: "canalSuma", label: "Canal: calculat", src: "Canalizare", type: "num", w: 90 },
  { key: "canalSprePlata", label: "Canal: spre plată", src: "CanalizareSprePlata", type: "num", w: 100 },
  { key: "canalTarif", label: "Canal: cotă", src: "CotaCanalizare", type: "num", w: 90 },
  { key: "gunoiSoldInit", label: "Gunoi: sold inițial", src: "GunoiSoldInit", type: "num", w: 100 },
  { key: "gunoiPlatit", label: "Gunoi: plătit", src: "GunoiPlatit", type: "num", w: 90 },
  { key: "gunoiRecalc", label: "Gunoi: recalcul", src: "GunoiRecalc", type: "num", w: 90 },
  { key: "gunoiSuma", label: "Gunoi: calculat", src: "Gunoi", type: "num", w: 90 },
  { key: "gunoiSprePlata", label: "Gunoi: spre plată", src: "GunoiSprePlata", type: "num", w: 100 },
  { key: "toSoldInit", label: "TO: sold inițial", src: "TOSoldInit", type: "num", w: 100 },
  { key: "toPlatit", label: "TO: plătit", src: "TOPlatit", type: "num", w: 90 },
  { key: "toRecalc", label: "TO: recalcul", src: "TORecalc", type: "num", w: 90 },
  { key: "toSuma", label: "TO: calculat", src: "TO", type: "num", w: 90 },
  { key: "toSprePlata", label: "TO: spre plată", src: "TOSprePlata", type: "num", w: 100 },
  { key: "toTarif", label: "TO: cotă", src: "CotaTO", type: "num", w: 80 },
  { key: "apartamentSoldInit", label: "Apartament: sold inițial", src: "ApartamentSoldInit", type: "num", w: 100 },
  { key: "apartamentPlatit", label: "Apartament: plătit", src: "ApartamentPlatit", type: "num", w: 90 },
  { key: "apartamentRecalc", label: "Apartament: recalcul", src: "ApartamentRecalc", type: "num", w: 90 },
  { key: "apartamentSuma", label: "Apartament: calculat", src: "Apartament", type: "num", w: 90 },
  { key: "apartamentSprePlata", label: "Apartament: spre plată", src: "ApartamentSprePlata", type: "num", w: 100 },
  { key: "contorActiv", label: "Nr. contor", src: "NrContor", type: "text", w: 110 },
  { key: "sigiliu", label: "Nr. plombă", src: "NrPlomba", type: "text", w: 100 },
  { key: "citirePrec", label: "Date vechi (index)", src: "DateVechi", type: "num", w: 100 },
  { key: "citireCurenta", label: "Date nou (index)", src: "DateNou", type: "num", w: 100 },
  { key: "consumTotal", label: "Volum (m³)", src: "Volum", type: "num", w: 90 },
];

export const ONEC_COLUMN_KEYS = ONEC_COLUMNS.map((c) => c.key);

/**
 * Detalii în forma folosită de paginile de contoare (lista contoarelor, istoricul lunar, raportul „estimate”). Noul 1C nu are
 * consumatori / contoare / citiri / linii ca tabele separate, dar le reconstruim dintr-un singur aviz ca aceste pagini să
 * funcționeze la fel: un contor (cu sigiliu), o citire (index vechi → nou, volum) și câte o linie de calcul pe serviciu.
 */
export type OneCConsumer = {
  perioada: string | null; nume: string; inn: string; inceput: string | null; sfarsit: string | null;
  zona: string; sector: string; nrPersoane: number; suprafata: number;
};
export type OneCMeter = {
  perioada: string | null; consumator: string; inn: string; contor: string; dataInstalare: string | null;
  sigiliu: string; dataScoatere: string | null; subAbonat: string; subContract: string; subCont: string;
  subConsumator: string; subContor: string;
};
export type OneCReading = {
  consumator: string; inn: string; contor: string; sursa: string; citirePrec: number; dataPrec: string | null;
  citire: number; dataCitire: string | null; consum: number; medie: number; consumSubcontoare: number;
};
export type OneCLine = {
  consumator: string; inn: string; contor: string; serviciu: string; volum: number; tarif: number; suma: number;
  data: string | null;
};

/** Un aviz exact cum îl întoarce 1C: toate valorile sunt șiruri (inclusiv sumele), cu spații la capete. */
export type OneCAviz = Record<string, unknown>;

export type OneCRecordData = {
  uid: string;
  nume: string;
  /** Din variabile legate de utilizator (Setări → Mapare 1C); altfel null. */
  telefon: string | null;
  inn: string | null;
  tipSector: string | null;
  sectorUchastok: string | null;
  nrContract: string | null;
  dataInstalare: string | null;
  contPersonal: string;
  strada: string | null;
  casa: string | null;
  apartament: string | null;
  dataDoc: string;
  lunaViitoare: string | null;
  calculat: number;
  soldInit: number;
  platit: number;
  recalc: number;
  datorieAvans: number;
  deAchitat: number;
  apaSuma: number;
  apaTarif: number | null;
  apaVolum: number | null;
  canalSuma: number;
  canalTarif: number | null;
  canalVolum: number | null;
  gunoiSuma: number;
  toSuma: number;
  toTarif: number | null;
  apartamentSuma: number;
  apaSoldInit: number;
  apaPlatit: number;
  apaRecalc: number;
  apaSprePlata: number;
  canalSoldInit: number;
  canalPlatit: number;
  canalRecalc: number;
  canalSprePlata: number;
  gunoiSoldInit: number;
  gunoiPlatit: number;
  gunoiRecalc: number;
  gunoiSprePlata: number;
  toSoldInit: number;
  toPlatit: number;
  toRecalc: number;
  toSprePlata: number;
  apartamentSoldInit: number;
  apartamentPlatit: number;
  apartamentRecalc: number;
  apartamentSprePlata: number;
  contorActiv: string | null;
  sigiliu: string | null;
  citirePrec: number | null;
  citireCurenta: number | null;
  consumTotal: number | null;
  nrContoare: number;
  invoiceNumber: string | null;
  consumers: OneCConsumer[];
  meters: OneCMeter[];
  readings: OneCReading[];
  lines: OneCLine[];
  /** Avizul original, neschimbat — pentru verificarea de către cei de la 1C. */
  raw: OneCAviz;
};

/** Numele serviciilor în liniile de calcul. Apa și canalizarea păstrează valorile după care caută paginile de contoare. */
export const SVC_WATER = "Потребление воды";
export const SVC_SEWER = "Сброс канализации";
export const SVC_GARBAGE = "Gunoi";
export const SVC_TO = "TO";
export const SVC_APARTMENT = "Apartament";

export const str = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();
export const num = (v: unknown): number => {
  const n = Number(String(v ?? "").trim().replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const round4 = (n: number): number => Math.round((n + Number.EPSILON) * 10_000) / 10_000;
const orNull = (s: string): string | null => (s && s !== "0" ? s : null);

/** Codul abonatului fără spații (1C îl scrie „72 041 465”): forma după care potrivim, stocăm și căutăm. */
export const compactCode = (v: unknown): string => String(v ?? "").replace(/\s+/g, "");

/** Data avizului ca „AAAA-LL-ZZ” (ora din „2026-10-31T23:59:59” se ignoră — e doar sfârșitul zilei). */
export function avizDay(v: unknown): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v ?? "").trim());
  return m ? m[1] : null;
}

/** „AAAA-LL” al avizului. */
export const avizMonth = (v: unknown): string | null => avizDay(v)?.slice(0, 7) ?? null;

/** Data emiterii: ziua avizului la prânz UTC, ca luna și ziua să rămână aceleași în orice fus orar (23:59:59 ar trece în luna următoare la Chișinău). */
export function avizIssueDate(v: unknown): Date | null {
  const d = avizDay(v);
  if (!d) return null;
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day, 12, 0, 0));
}

/** Mărimile financiare ale unui aviz, calculate la fel peste tot (factură, înregistrare 1C, comparații). */
export function avizAmounts(a: OneCAviz) {
  const total = round2(num(a["Total"]));
  const soldInit = round2(num(a["TotalSoldInit"]));
  const platit = round2(num(a["TotalPlatit"]));
  const recalc = round2(num(a["TotalRecalc"]));
  return {
    /** Calculat în luna avizului. */
    total,
    soldInit,
    platit,
    recalc,
    /** Datoria rămasă din lunile trecute după plățile lunii (negativ = avans). */
    datorieAvans: round2(soldInit - platit),
    /** Suma de plată: TotalSprePlata (= sold inițial − plătit + recalcul + calculat). */
    deAchitat: round2(num(a["TotalSprePlata"])),
  };
}

/** Un serviciu al avizului: suma, volumul (doar apă / canal) și prețul efectiv pe unitate. */
export type AvizService = { key: "apa" | "canal" | "gunoi" | "to" | "apartament"; label: string; svc: string; suma: number; volum: number; tarif: number };

export function avizServices(a: OneCAviz): AvizService[] {
  const vol = round2(num(a["Volum"]));
  // Prețul efectiv = suma / volum (abonații fără contor se taxează cu o cotă diferită de cea a contorului), altfel cota afișată.
  const unit = (suma: number, cota: number) => (vol > 0 ? round4(suma / vol) : cota);
  const apa = round2(num(a["ApaUdare"]));
  const canal = round2(num(a["Canalizare"]));
  const out: AvizService[] = [];
  if (apa !== 0) out.push({ key: "apa", label: "Serviciul de alimentare cu apă", svc: SVC_WATER, suma: apa, volum: vol, tarif: unit(apa, num(a["CotaContorRece"])) });
  if (canal !== 0) out.push({ key: "canal", label: "Serviciul de canalizare", svc: SVC_SEWER, suma: canal, volum: vol, tarif: unit(canal, num(a["CotaCanalizare"])) });
  const gunoi = round2(num(a["Gunoi"]));
  if (gunoi !== 0) out.push({ key: "gunoi", label: "Gunoi", svc: SVC_GARBAGE, suma: gunoi, volum: 0, tarif: 0 });
  const to = round2(num(a["TO"]));
  if (to !== 0) out.push({ key: "to", label: "TO", svc: SVC_TO, suma: to, volum: 0, tarif: num(a["CotaTO"]) });
  const apt = round2(num(a["Apartament"]));
  if (apt !== 0) out.push({ key: "apartament", label: "Apartament", svc: SVC_APARTMENT, suma: apt, volum: 0, tarif: 0 });
  return out;
}

/** Adresa de consum: „Strada, nr. N, ap. M” (Strada din 1C conține și localitatea; „0” înseamnă gol). */
export function avizAddress(a: OneCAviz): string | null {
  const strada = orNull(str(a["Strada"]));
  const casa = orNull(str(a["Casa"]));
  const apt = orNull(str(a["NrApartament"]));
  return [strada, casa ? `nr. ${casa}` : "", apt ? `ap. ${apt}` : ""].filter(Boolean).join(", ") || null;
}

/** Contorul avizului (număr + sigiliu); null când abonatul nu are contor (se taxează după normă). */
export function avizMeter(a: OneCAviz): { contor: string; sigiliu: string | null; prev: number; curr: number } | null {
  const contor = str(a["NrContor"]);
  if (!contor) return null;
  return { contor, sigiliu: orNull(str(a["NrPlomba"])), prev: num(a["DateVechi"]), curr: num(a["DateNou"]) };
}

/** Înregistrarea "Tabelul 1C" a unui aviz. `uid` și `invoiceNumber` le stabilește importul (după duplicate / facturile existente). */
/** Valorile variabilelor legate de utilizator (Setări → Mapare 1C), care completează câmpurile Tabelului 1C ce nu există în avizul standard. */
export type OneCRecordExtra = {
  telefon?: string | null; inn?: string | null; tipSector?: string | null; sectorUchastok?: string | null;
  nrContract?: string | null; dataInstalare?: string | null; sursa?: string | null;
};

export function buildOneCRecord(a: OneCAviz, ids: { uid: string; invoiceNumber: string | null }, extra: OneCRecordExtra = {}): OneCRecordData {
  const dataDoc = avizDay(a["Data"]) ?? "";
  const amounts = avizAmounts(a);
  const services = avizServices(a);
  const meter = avizMeter(a);
  const vol = round2(num(a["Volum"]));
  const svc = (k: AvizService["key"]) => services.find((s) => s.key === k);
  const water = svc("apa");
  const sewer = svc("canal");
  const contPersonal = compactCode(a["AbonentCod"]);

  const meters: OneCMeter[] = meter
    ? [{ perioada: dataDoc || null, consumator: "", inn: extra.inn ?? "", contor: meter.contor, dataInstalare: extra.dataInstalare ?? null, sigiliu: meter.sigiliu ?? "", dataScoatere: null, subAbonat: "", subContract: "", subCont: "", subConsumator: "", subContor: "" }]
    : [];
  const readings: OneCReading[] = meter
    ? [{ consumator: "", inn: extra.inn ?? "", contor: meter.contor, sursa: extra.sursa ?? "", citirePrec: meter.prev, dataPrec: null, citire: meter.curr, dataCitire: null, consum: vol, medie: 0, consumSubcontoare: 0 }]
    : [];
  const lines: OneCLine[] = services.map((s) => ({
    consumator: "", inn: "", contor: meter?.contor ?? "", serviciu: s.svc, volum: s.volum, tarif: s.tarif, suma: s.suma, data: dataDoc || null,
  }));

  return {
    uid: ids.uid,
    nume: str(a["Abonent"]),
    telefon: extra.telefon ?? null,
    inn: extra.inn ?? null,
    tipSector: extra.tipSector ?? null,
    sectorUchastok: extra.sectorUchastok ?? null,
    nrContract: extra.nrContract ?? null,
    dataInstalare: extra.dataInstalare ?? null,
    contPersonal,
    strada: orNull(str(a["Strada"])),
    casa: orNull(str(a["Casa"])),
    apartament: orNull(str(a["NrApartament"])),
    dataDoc,
    lunaViitoare: str(a["LunaViitoare"]) || null,
    calculat: amounts.total,
    soldInit: amounts.soldInit,
    platit: amounts.platit,
    recalc: amounts.recalc,
    datorieAvans: amounts.datorieAvans,
    deAchitat: amounts.deAchitat,
    apaSuma: water?.suma ?? 0,
    apaTarif: water ? water.tarif : num(a["CotaContorRece"]) || null,
    apaVolum: water && vol > 0 ? vol : null,
    canalSuma: sewer?.suma ?? 0,
    canalTarif: sewer ? sewer.tarif : num(a["CotaCanalizare"]) || null,
    canalVolum: sewer && vol > 0 ? vol : null,
    gunoiSuma: svc("gunoi")?.suma ?? 0,
    toSuma: svc("to")?.suma ?? 0,
    toTarif: num(a["CotaTO"]) || null,
    apartamentSuma: svc("apartament")?.suma ?? 0,
    apaSoldInit: round2(num(a["ApaSoldInit"])),
    apaPlatit: round2(num(a["ApaPlatit"])),
    apaRecalc: round2(num(a["ApaRecalc"])),
    apaSprePlata: round2(num(a["ApaSprePlata"])),
    canalSoldInit: round2(num(a["CanalizareSoldInit"])),
    canalPlatit: round2(num(a["CanalizarePlatit"])),
    canalRecalc: round2(num(a["CanalizareRecalc"])),
    canalSprePlata: round2(num(a["CanalizareSprePlata"])),
    gunoiSoldInit: round2(num(a["GunoiSoldInit"])),
    gunoiPlatit: round2(num(a["GunoiPlatit"])),
    gunoiRecalc: round2(num(a["GunoiRecalc"])),
    gunoiSprePlata: round2(num(a["GunoiSprePlata"])),
    toSoldInit: round2(num(a["TOSoldInit"])),
    toPlatit: round2(num(a["TOPlatit"])),
    toRecalc: round2(num(a["TORecalc"])),
    toSprePlata: round2(num(a["TOSprePlata"])),
    apartamentSoldInit: round2(num(a["ApartamentSoldInit"])),
    apartamentPlatit: round2(num(a["ApartamentPlatit"])),
    apartamentRecalc: round2(num(a["ApartamentRecalc"])),
    apartamentSprePlata: round2(num(a["ApartamentSprePlata"])),
    contorActiv: meter?.contor ?? null,
    sigiliu: meter?.sigiliu ?? null,
    citirePrec: meter ? meter.prev : null,
    citireCurenta: meter ? meter.curr : null,
    consumTotal: a["Volum"] === "" || a["Volum"] == null ? null : vol,
    nrContoare: meter ? 1 : 0,
    invoiceNumber: ids.invoiceNumber,
    consumers: [],
    meters,
    readings,
    lines,
    raw: a,
  };
}

/**
 * Compară două nume de abonat fără diacritice / majuscule / ordine / semne de punctuație („Lungu Eugeniu” = „LUNGU  EUGENIU.”),
 * iar un nume care îl conține complet pe celălalt („Lungu Eugeniu” ⊂ „Lungu Eugeniu Ion”) se consideră același. Așa recunoaștem
 * că un cod de abonat din 1C e al aceluiași om ca un client existent, dar nu suprascriem un client străin care are doar același cod.
 */
export function nameTokens(name: string): string[] {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter(Boolean);
}

export function sameSubscriber(a: string | null | undefined, b: string | null | undefined): boolean {
  const ta = nameTokens(a ?? "");
  const tb = nameTokens(b ?? "");
  if (!ta.length || !tb.length) return false;
  const [small, big] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const set = new Set(big);
  return small.every((t) => set.has(t));
}
