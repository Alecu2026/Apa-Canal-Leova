/**
 * Harta variabilelor: ce variabile are aplicația, ce câmpuri trimite 1C și cum se leagă (pagina Setări → Mapare 1C).
 *
 * Trei feluri de variabile ale aplicației:
 *  – „fixă”: legătura e în codul importului (ex. nume ← Abonent) — se vede, dar nu se schimbă din pagină;
 *  – „legabilă”: o completează sincronizarea DOAR dacă o legi de un câmp 1C (ex. telefon) — acum 1C nu are câmpul, deci apare „lipsește”;
 *  – „locală”: există doar în aplicație (notițe, expirarea contractului…), 1C nu o trimite și nu trebuie.
 * Modul pur (fără server-only): îl folosesc și pagina, și importul.
 */
import type { OneCAviz } from "./apa-canal-1c";

export type AppFieldKind = "fixed" | "mappable" | "local";
export type AppFieldGroup = "client" | "invoice" | "meter" | "local";

export type AppField = {
  /** Cheia stabilă (se salvează în baza de date la legări). */
  key: string;
  label: string;
  group: AppFieldGroup;
  /** Unde ajunge în aplicație. */
  where: string;
  kind: AppFieldKind;
  /** La „fixă”: câmpurile 1C folosite de cod. */
  builtIn?: string[];
  /** La „fixă”: cum se calculează, când nu e o simplă copiere. */
  note?: string;
  /** Funcțiile care au nevoie de ea (cheile din FEATURES). */
  needs: string[];
};

export const GROUP_LABEL: Record<AppFieldGroup, string> = {
  client: "Plătitor",
  invoice: "Factură",
  meter: "Contor",
  local: "Doar în aplicație",
};

/** Soldul inițial, plătitul, recalculul și suma spre plată pentru fiecare serviciu (apă, canalizare, gunoi, TO, apartament). */
const BREAKDOWN_KEYS = ["Apa", "Canalizare", "Gunoi", "TO", "Apartament"].flatMap((k) => [`${k}SoldInit`, `${k}Platit`, `${k}Recalc`, `${k}SprePlata`]);

export const APP_FIELDS: AppField[] = [
  // ── Plătitor ──
  { key: "client.name", label: "Nume abonat", group: "client", where: "Client.name", kind: "fixed", builtIn: ["Abonent"], needs: ["invoices", "portal"] },
  { key: "client.meterSeries", label: "Cod abonat (cont personal, login portal)", group: "client", where: "Client.meterSeries", kind: "fixed", builtIn: ["AbonentCod"], note: "Fără spații („72 041 465” → 72041465).", needs: ["portal", "invoices"] },
  { key: "client.consumAddress", label: "Adresa de consum", group: "client", where: "Client.consumAddress", kind: "fixed", builtIn: ["Strada", "Casa", "NrApartament"], note: "Stradă, nr. casă, ap.", needs: ["invoices"] },
  { key: "client.balance", label: "Sold curent", group: "client", where: "Client.lastInvoiceGrandTotal", kind: "fixed", builtIn: ["TotalSprePlata"], needs: ["balance"] },
  { key: "client.phone", label: "Telefon", group: "client", where: "Client.phone", kind: "mappable", needs: ["sms"] },
  { key: "client.email", label: "Email", group: "client", where: "Client.email", kind: "mappable", needs: ["email"] },
  { key: "client.contract", label: "Nr. contract (firme, instituții)", group: "client", where: "Client.apaCanalContract", kind: "mappable", needs: ["firms"] },
  { key: "client.idno", label: "IDNO / cod fiscal", group: "client", where: "Tabelul 1C → IDNO", kind: "mappable", needs: ["firms"] },
  { key: "client.sector", label: "Tip sector (privat / comunal)", group: "client", where: "Factura și Client → sector", kind: "mappable", needs: ["sector"] },
  { key: "client.sector1c", label: "Sector 1C („Участок”)", group: "client", where: "Tabelul 1C → Sector 1C", kind: "mappable", needs: ["sector1c"] },
  // ── Factură ──
  { key: "invoice.issueDate", label: "Data facturii (luna)", group: "invoice", where: "Invoice.issueDate", kind: "fixed", builtIn: ["Data"], note: "Ziua avizului; luna facturii = luna avizului.", needs: ["invoices", "balance"] },
  { key: "invoice.subtotal", label: "Calculat în lună", group: "invoice", where: "Invoice.subtotal", kind: "fixed", builtIn: ["Total"], needs: ["invoices", "balance"] },
  { key: "invoice.datoriiAvans", label: "Datorie / avans din lunile trecute", group: "invoice", where: "Invoice.datoriiAvans", kind: "fixed", builtIn: ["TotalSoldInit", "TotalPlatit"], note: "Sold inițial − plătit în lună.", needs: ["balance", "invoices"] },
  { key: "invoice.recalculari", label: "Recalcul", group: "invoice", where: "Invoice.recalculari", kind: "fixed", builtIn: ["TotalRecalc"], needs: ["invoices"] },
  { key: "invoice.grandTotal", label: "Total de plată", group: "invoice", where: "Invoice.grandTotal", kind: "fixed", builtIn: ["TotalSprePlata"], needs: ["invoices", "balance"] },
  { key: "invoice.status", label: "Status factură (achitată / restantă)", group: "invoice", where: "Invoice.status", kind: "fixed", builtIn: ["TotalSoldInit", "TotalPlatit", "TotalSprePlata"], note: "Dedus: din datoria facturii următoare sau din absența abonatului în luna următoare (1C scoate abonații cu sold ≤ 0).", needs: ["balance"] },
  { key: "invoice.itemApa", label: "Linie factură: apă", group: "invoice", where: "InvoiceItem", kind: "fixed", builtIn: ["ApaUdare", "Volum", "CotaContorRece"], needs: ["invoices"] },
  { key: "invoice.itemCanal", label: "Linie factură: canalizare", group: "invoice", where: "InvoiceItem", kind: "fixed", builtIn: ["Canalizare", "Volum", "CotaCanalizare"], needs: ["invoices"] },
  { key: "invoice.itemGunoi", label: "Linie factură: gunoi", group: "invoice", where: "InvoiceItem", kind: "fixed", builtIn: ["Gunoi"], needs: ["invoices"] },
  { key: "invoice.itemTo", label: "Linie factură: TO", group: "invoice", where: "InvoiceItem", kind: "fixed", builtIn: ["TO", "CotaTO"], needs: ["invoices"] },
  { key: "invoice.itemApartament", label: "Linie factură: apartament", group: "invoice", where: "InvoiceItem", kind: "fixed", builtIn: ["Apartament"], needs: ["invoices"] },
  // ── Contor ──
  { key: "meter.number", label: "Număr contor", group: "meter", where: "Client.meterNumber · Invoice.meterNumber", kind: "fixed", builtIn: ["NrContor"], needs: ["meters", "invoices"] },
  { key: "meter.seal", label: "Număr plombă (sigiliu)", group: "meter", where: "Tabelul 1C → Nr. plombă", kind: "fixed", builtIn: ["NrPlomba"], needs: ["meters"] },
  { key: "meter.prev", label: "Index vechi", group: "meter", where: "Invoice.meterPrevReading", kind: "fixed", builtIn: ["DateVechi"], needs: ["meters", "invoices"] },
  { key: "meter.curr", label: "Index nou", group: "meter", where: "Client.meterCurrReading · Invoice.meterCurrReading", kind: "fixed", builtIn: ["DateNou"], needs: ["meters", "invoices"] },
  { key: "meter.volume", label: "Volum consumat", group: "meter", where: "Invoice.monthlyConsumption", kind: "fixed", builtIn: ["Volum"], needs: ["meters"] },
  { key: "meter.installDate", label: "Data instalării contorului", group: "meter", where: "Tabelul 1C → Data instalării", kind: "mappable", needs: ["install"] },
  { key: "meter.readingSource", label: "Sursa citirii (citit / calculat)", group: "meter", where: "Citire · Invoice.isEstimatedVolume", kind: "mappable", needs: ["estimated"] },
  // ── Date 1C afișate (Tabelul 1C și fișa plătitorului) ──
  { key: "onec.breakdown", label: "Defalcare pe servicii (sold, plătit, recalcul, spre plată)", group: "invoice", where: "Tabelul 1C · fișa plătitorului", kind: "fixed", builtIn: BREAKDOWN_KEYS, note: "Doar afișate; nu intră în factură.", needs: [] },
  { key: "onec.nextMonth", label: "Luna următoare (text)", group: "invoice", where: "Tabelul 1C · fișa plătitorului", kind: "fixed", builtIn: ["LunaViitoare"], note: "Doar afișată.", needs: [] },
  // ── Doar în aplicație ──
  { key: "local.notes", label: "Notițe, apeluri, cereri", group: "local", where: "PayerNote · Task", kind: "local", needs: [] },
  { key: "local.contractExpiresAt", label: "Expirarea contractului", group: "local", where: "Client.contractExpiresAt", kind: "local", needs: [] },
  { key: "local.metrology", label: "Verificare metrologică, nereguli de contor", group: "local", where: "MeterMetrology · MeterIssue", kind: "local", needs: [] },
  { key: "local.portal", label: "Cont de portal (parolă, activare)", group: "local", where: "Client.portalPasswordHash", kind: "local", needs: [] },
];

export type Feature = { key: string; label: string; why: string };

/** Ce funcții ale aplicației depind de ce variabile (o funcție merge „complet” doar dacă toate variabilele ei au sursă). */
export const FEATURES: Feature[] = [
  { key: "invoices", label: "Facturi și PDF", why: "Numele, adresa, sumele și liniile de pe factură." },
  { key: "balance", label: "Solduri și statusuri (achitat / restant)", why: "Datoria, plățile și totalul din care se deduce statusul." },
  { key: "meters", label: "Contoare și citiri", why: "Numărul contorului, indexurile și volumul." },
  { key: "portal", label: "Portal client (login cu codul abonatului)", why: "Clientul se loghează cu codul abonatului." },
  { key: "sms", label: "Notificări SMS și apeluri", why: "Fără număr de telefon nu are cui să trimită." },
  { key: "email", label: "Notificări email", why: "Fără adresă de email nu are cui să trimită." },
  { key: "firms", label: "Firme și instituții", why: "Se deosebesc de persoane după nr. de contract / IDNO." },
  { key: "sector", label: "Filtre pe sector (privat / comunal)", why: "Filtrele și coloana de sector din Plătitori." },
  { key: "sector1c", label: "Filtru pe sectorul 1C („Участок”)", why: "Necesită sectorul din 1C." },
  { key: "install", label: "Filtru „contor instalat după” și sortare după instalare", why: "Necesită data instalării contorului." },
  { key: "estimated", label: "Raport „contoare estimate”", why: "Necesită sursa citirii (citit sau calculat)." },
];

/** Câmpurile cunoscute din răspunsul 1C `…/infoCec/info/apl` (cele 45 verificate), cu o descriere scurtă. */
export type OneCField = { key: string; label: string; group: string };
const SERVICES: [string, string][] = [["Apa", "Apă"], ["Canalizare", "Canalizare"], ["Gunoi", "Gunoi"], ["TO", "TO"], ["Apartament", "Apartament"]];
export const KNOWN_1C_FIELDS: OneCField[] = [
  { key: "Abonent", label: "Numele abonatului", group: "Abonat" },
  { key: "AbonentCod", label: "Codul abonatului", group: "Abonat" },
  { key: "Strada", label: "Strada (uneori cu localitatea)", group: "Abonat" },
  { key: "Casa", label: "Număr casă", group: "Abonat" },
  { key: "NrApartament", label: "Număr apartament", group: "Abonat" },
  { key: "Data", label: "Data avizului (sfârșit de lună)", group: "Aviz" },
  { key: "LunaViitoare", label: "Luna următoare (text)", group: "Aviz" },
  { key: "Total", label: "Total calculat în lună", group: "Totaluri" },
  { key: "TotalSoldInit", label: "Total sold inițial", group: "Totaluri" },
  { key: "TotalPlatit", label: "Total plătit în lună", group: "Totaluri" },
  { key: "TotalRecalc", label: "Total recalcul", group: "Totaluri" },
  { key: "TotalSprePlata", label: "Total spre plată", group: "Totaluri" },
  ...SERVICES.flatMap(([k, label]) => [
    { key: `${k}SoldInit`, label: `${label}: sold inițial`, group: label },
    { key: `${k}Platit`, label: `${label}: plătit`, group: label },
    { key: `${k}Recalc`, label: `${label}: recalcul`, group: label },
    { key: k === "Apa" ? "ApaUdare" : k, label: `${label}: calculat în lună`, group: label },
    { key: `${k}SprePlata`, label: `${label}: spre plată`, group: label },
  ]),
  { key: "CotaContorRece", label: "Cotă apă (contor rece)", group: "Cote" },
  { key: "CotaCanalizare", label: "Cotă canalizare", group: "Cote" },
  { key: "CotaTO", label: "Cotă TO", group: "Cote" },
  { key: "NrContor", label: "Număr contor", group: "Contor" },
  { key: "NrPlomba", label: "Număr plombă", group: "Contor" },
  { key: "DateVechi", label: "Index vechi", group: "Contor" },
  { key: "DateNou", label: "Index nou", group: "Contor" },
  { key: "Volum", label: "Volum (m³)", group: "Contor" },
];

export const SECTOR_RO: Record<string, string> = { "Частный": "Sector privat", "Коммунальный": "Sector comunal" };

/** Cheile variabilelor „legabile” — singurele pe care importul le completează din legături. */
export const MAPPABLE_KEYS = APP_FIELDS.filter((f) => f.kind === "mappable").map((f) => f.key);

/** appField → câmp 1C, doar legăturile valide (variabilă legabilă, nume de câmp nevid). */
export function cleanMappings(raw: Record<string, string | null | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of MAPPABLE_KEYS) {
    const v = typeof raw[k] === "string" ? raw[k]!.trim() : "";
    if (v) out[k] = v.slice(0, 80);
  }
  return out;
}

export type MappedValues = {
  phone: string | null;
  email: string | null;
  contract: string | null;
  idno: string | null;
  sector: string | null;
  sector1c: string | null;
  installDate: string | null;
  readingSource: string | null;
};

const text = (v: unknown): string | null => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s && s !== "0" ? s : null;
};

/** Valorile variabilelor legabile pentru un aviz, după legăturile făcute (fără legătură = null). */
export function mappedValues(a: OneCAviz, mappings: Record<string, string> | undefined): MappedValues {
  const get = (field: string) => (mappings?.[field] ? text(a[mappings[field]]) : null);
  const sector = get("client.sector");
  const install = get("meter.installDate");
  return {
    phone: get("client.phone"),
    email: get("client.email")?.toLowerCase() ?? null,
    contract: get("client.contract"),
    idno: get("client.idno"),
    sector: sector ? SECTOR_RO[sector] ?? sector : null,
    sector1c: get("client.sector1c"),
    installDate: install ? /^(\d{4}-\d{2}-\d{2})/.exec(install)?.[1] ?? install : null,
    readingSource: get("meter.readingSource"),
  };
}

export type FieldStatus = "connected" | "missing" | "local";

/** Starea unei variabile a aplicației: legată (fix în cod sau de utilizator), lipsește, sau locală. */
export function fieldStatus(f: AppField, mappings: Record<string, string>): { status: FieldStatus; sources: string[] } {
  if (f.kind === "local") return { status: "local", sources: [] };
  if (f.kind === "fixed") return { status: "connected", sources: f.builtIn ?? [] };
  const s = mappings[f.key];
  return s ? { status: "connected", sources: [s] } : { status: "missing", sources: [] };
}

/** Starea fiecărei funcții: ok dacă toate variabilele de care depinde au sursă; altfel lista a ce lipsește. */
export function featureStatus(mappings: Record<string, string>): { feature: Feature; ok: boolean; missing: AppField[] }[] {
  return FEATURES.map((feature) => {
    const missing = APP_FIELDS.filter((f) => f.needs.includes(feature.key) && fieldStatus(f, mappings).status === "missing");
    return { feature, ok: missing.length === 0, missing };
  });
}

/** Aceeași regulă ca isEstimatedSource (lib/meters.ts): sursa „Расчетный” / „estimat…” = citire calculată, nu făcută de un cititor. */
export const isEstimatedReading = (s: string | null | undefined): boolean => !!s && /расч|estimat/i.test(s);
