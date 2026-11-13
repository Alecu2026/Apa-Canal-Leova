import "server-only";
import { randomBytes } from "node:crypto";
import iconv from "iconv-lite";
import { ObjectId } from "mongodb";
import type { Prisma } from "@prisma/client";
import {
  avizAddress, avizAmounts, avizIssueDate, avizMeter, avizMonth, avizServices, buildOneCRecord, compactCode, nameTokens, num, round2, sameSubscriber, str,
  type OneCAviz, type OneCRecordData,
} from "../apa-canal-1c";
import { cleanMappings, isEstimatedReading, mappedValues } from "../onec-map";
import { prisma } from "../prisma";
import { bumpClientEpoch, bumpClientSearchEpoch } from "../lookup-memory";
import { apaCanalDueDate } from "../apa-canal-due";

/**
 * Import date Apă-Canal din noul serviciu 1C (Leova): `…/hs/infoCec/info/apl/<dată>` întoarce, pentru luna din dată, o LISTĂ de avize de plată — câte unul per abonat
 * (nume, cod, adresă, soldurile și plățile pe servicii, cotele, indicii vechi / noi, nr. contorului și al sigiliului). Detalii: lib/apa-canal-1c.ts.
 *
 * Nucleul e REFOLOSIT de sincronizarea din API (cron + butonul din Plătitori + trimiterea citirilor) și de încărcarea manuală a unui fișier JSON salvat din același serviciu.
 * Un răspuns poate conține mai multe luni (sincronizarea cere luna închisă + cea curentă): fiecare aviz își poartă luna în câmpul `Data`.
 */

/** Răspunsul 1C: lista avizelor, exact cum au venit. */
export type ApaCanalRawData = OneCAviz[];

const LUNI_RO = [
  "IANUARIE", "FEBRUARIE", "MARTIE", "APRILIE", "MAI", "IUNIE",
  "IULIE", "AUGUST", "SEPTEMBRIE", "OCTOMBRIE", "NOIEMBRIE", "DECEMBRIE",
];

const oid = () => new ObjectId().toHexString();
const genToken = () => randomBytes(18).toString("base64url");
const norm = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const pad5 = (n: unknown) => {
  const s = String(Math.trunc(Number(n) || 0));
  return s.length < 5 ? s.padStart(5, "0") : s;
};

/**
 * Decodează răspunsul. Serviciul întoarce UTF-8, dar acceptăm și BOM / UTF-16 / Windows-1251 (un fișier salvat din alt program): încercăm întâi UTF-8
 * (dacă parsează curat și nu conține U+FFFD), altfel Windows-1251. Întoarce lista avizelor — goală („[]”) cât timp luna cerută nu are avize (de ex. luna curentă, încă neînchisă).
 */
export function parseApaCanalBuffer(input: Buffer): ApaCanalRawData {
  let buf = input;
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) buf = buf.subarray(3);
  else if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) buf = Buffer.from(buf.subarray(2).toString("utf16le"), "utf-8");
  else if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const sw = Buffer.from(buf.subarray(2));
    sw.swap16();
    buf = Buffer.from(sw.toString("utf16le"), "utf-8");
  }

  const tryUtf8 = (): unknown => {
    const text = buf.toString("utf-8");
    if (text.includes("�")) return undefined;
    try { return JSON.parse(text); } catch { return undefined; }
  };
  const tryWin1251 = (): unknown => {
    try { return JSON.parse(iconv.decode(buf, "win1251")); } catch { return undefined; }
  };
  const parsed = tryUtf8() ?? tryWin1251();
  if (parsed === undefined) throw new Error("Răspunsul nu este JSON valid (nici UTF-8, nici Windows-1251).");

  // Unele fișiere salvate împachetează lista ({ "data": [...] }): o desfacem.
  let list: unknown = parsed;
  if (!Array.isArray(list) && list && typeof list === "object") {
    list = Object.values(list as Record<string, unknown>).find((v) => Array.isArray(v));
  }
  if (!Array.isArray(list)) throw new Error("Nu găsesc lista de avize în răspuns (se aștepta o listă JSON cu câmpurile Abonent, AbonentCod, Total…).");

  const rows = list.filter((x): x is OneCAviz => !!x && typeof x === "object" && !Array.isArray(x));
  if (rows.length > 0 && !rows.slice(0, 50).some((r) => "AbonentCod" in r && "Abonent" in r)) {
    throw new Error("Răspunsul nu pare avizele de plată 1C (lipsesc câmpurile Abonent / AbonentCod) — format diferit față de serviciul infoCec?");
  }
  return rows;
}

export type ExistingClientLite = {
  id: string;
  name: string;
  /** Telefonul și emailul din aplicație — se suprascriu doar când variabila e legată de un câmp 1C (Setări → Mapare 1C) și 1C trimite o valoare. */
  phone?: string | null;
  email?: string | null;
  /** Instantaneul datelor 1C de pe fișa plătitorului — comparat cu 1C la fiecare sincronizare (oglindire). */
  consumAddress?: string | null;
  meterNumber?: string | null;
  meterCurrReading?: number | null;
  meterReadingEstimated?: boolean | null;
  lastInvoiceGrandTotal?: number | null;
  lastInvoiceSectorNr?: string | null;
  meterSeries: string | null;
  portalActivatedAt: Date | null;
  /** Data ultimei facturi (instantaneul din Client) — un import mai vechi nu are voie să o dea înapoi. */
  lastInvoiceIssueDate?: Date | null;
  /** Nr. contract 1C al firmelor (fără cont personal) — vezi Client.apaCanalContract. */
  apaCanalContract?: string | null;
};

export type ExistingInvoiceLite = {
  clientId: string | null;
  issueDate: Date;
  /** Valorile stocate — pentru a actualiza o factură existentă când 1C trimite date corectate. */
  id?: string;
  meterNumber?: string | null;
  meterPrevReading?: string | null;
  meterCurrReading?: string | null;
  subtotal?: number | null;
  datoriiAvans?: number | null;
  recalculari?: number | null;
  status?: string | null;
  grandTotal?: number | null;
  dueDate?: Date | null;
  consumAddress?: string | null;
  consumerName?: string | null;
  sectorNr?: string | null;
  isEstimatedVolume?: boolean | null;
  /** Amprenta listei de contoare (vezi Invoice.metersSig). */
  metersSig?: string | null;
};

// Scadența facturilor Apă-Canal = ziua de 25 a lunii următoare celei a facturii (vezi lib/apa-canal-due.ts).
const dueDateFrom = apaCanalDueDate;

export type ApaCanalPlanStats = {
  documenteTotale: number;
  sariteFaraAbonent: number;
  clientiNoiDeCreat: number;
  clientiExistentiActualizati: number;
  dinCareCuContActivatPastrat: number;
  coliziuniContPersonal: number;
  facturiDeCreat: number;
  facturiSaritePreexistente: number;
  /** Din cele existente: câte au primit date corectate din 1C (contor, citiri, sume). */
  facturiActualizate: number;
  /** Facturi marcate „Achitată” fiindcă abonatul nu mai apare în luna următoare (1C scoate din listă abonații cu sold ≤ 0). */
  facturiAchitateDinAbsenta: number;
  liniiFacturaDeCreat: number;
  totalNecuvenit: number;
  totalDePlata: number;
};

/** Ce s-a întâmplat cu fiecare aviz din fișier/API — pentru raportul detaliat din "Sincronizare API". */
export type ApaCanalDocOutcome = {
  uid: string;
  number: string | null;
  name: string;
  contPersonal: string | null;
  contract?: string | null;
  period: string | null;
  status: "nou" | "existent" | "actualizat" | "sarit";
  clientNou?: boolean;
  motiv?: string;
  /** La "actualizat": ce s-a schimbat (valoarea din aplicație → valoarea nouă din 1C). */
  diffs?: { camp: string; api: string; aplicatie: string }[];
  api: { calculat: number; datorie: number; deAchitat: number; citirePrec: string | null; citireCurenta: string | null } | null;
};

/** Un abonat dintr-o lună a noului 1C: factura și clientul lui. */
export type SubInfo = { number: string; clientId: string | null; name: string };

const nextMonthKey = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
};
export const prevMonthKey = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
};

export type PlannedOneCRecord = OneCRecordData & { clientId: string | null };

export type ApaCanalPlan = {
  clientsToCreate: Prisma.ClientCreateManyInput[];
  clientUpdates: { id: string; data: Prisma.ClientUpdateInput }[];
  invoicesToCreate: Prisma.InvoiceCreateManyInput[];
  itemsToCreate: Prisma.InvoiceItemCreateManyInput[];
  /** Facturi existente (aceeași lună) ale căror date din 1C s-au schimbat: câmpuri noi + liniile de calcul refăcute. */
  invoiceUpdates: { id: string; data: Prisma.InvoiceUpdateInput; items: Prisma.InvoiceItemCreateManyInput[] | null }[];
  /** "Tabelul 1C": câte o înregistrare per aviz. */
  records: PlannedOneCRecord[];
  stats: ApaCanalPlanStats;
  docs: ApaCanalDocOutcome[];
};

/**
 * Construiește planul de import (pur, fără nicio scriere în bază) — id-uri Mongo pre-generate, ca să putem lega facturile/liniile de clienți fără dus-întors la bază per rând.
 * Avizele se procesează de la luna cea mai veche la cea mai nouă (instantaneul „ultima factură” al clientului rămâne cel mai recent).
 *
 * Identitate: codul abonatului (AbonentCod, fără spații) = cont personal = Client.meterSeries = parte din numărul facturii (`AC-<cod>`). Aplicația a fost folosită și cu alt operator 1C
 * (Cahul), deci același cod poate exista la un alt om: NICIO potrivire după cod/număr de factură nu e acceptată fără ca numele să fie același (sameSubscriber). Un cod
 * al altcuiva nu se suprascrie niciodată — abonatul din 1C devine un client nou (fără cod de portal, dacă acela e deja luat) și o factură cu număr distinct.
 *
 * Număr factură: `AC-<cod>` dacă e liber sau e chiar factura acestui abonat din aceeași lună; altfel `AC-<cod>-AAAALL` (luna din care vine avizul), apoi `-2`, `-3`…
 * O sincronizare din aceeași lună actualizează factura existentă (nu o dublează), una dintr-o lună nouă adaugă o factură nouă.
 *
 * Oglindire: datele din 1C câștigă MEREU; câmpurile care există DOAR în aplicație (telefon, email, notițe, Telegram, parolă portal, programări…) nu se ating,
 * iar un câmp lipsă din 1C nu șterge valoarea din aplicație.
 */
export function buildApaCanalPlan(
  data: ApaCanalRawData,
  ctx: {
    ownerId: string;
    existingClients: ExistingClientLite[];
    existingInvoiceNumbers: Set<string>;
    /** number → {clientId, issueDate, …}; permite potrivirea după factură și numerotarea pe luni. */
    existingInvoices?: Map<string, ExistingInvoiceLite>;
    /** Abonații din luna dinaintea primei luni din răspuns (din Tabelul 1C, doar înregistrările noului 1C) — ca să știm cine a dispărut din prima lună a răspunsului. */
    prevMonth?: { month: string; subs: Map<string, SubInfo> };
    /** Legăturile variabilă a aplicației → câmp 1C făcute în Setări → Mapare 1C (ex. "client.phone" → "Telefon"). */
    mappings?: Record<string, string>;
  },
): ApaCanalPlan {
  const rows = data
    .map((a, i) => ({ a, i }))
    .sort((x, y) => (str(x.a["Data"]) < str(y.a["Data"]) ? -1 : str(x.a["Data"]) > str(y.a["Data"]) ? 1 : x.i - y.i))
    .map((x) => x.a);

  const clientsByNameKey = new Map<string, ExistingClientLite[]>();
  for (const c of ctx.existingClients) {
    const list = clientsByNameKey.get(norm(c.name)) ?? [];
    list.push(c);
    clientsByNameKey.set(norm(c.name), list);
  }
  const clientBySeries = new Map(ctx.existingClients.filter((c) => c.meterSeries).map((c) => [compactCode(c.meterSeries), c]));
  const clientById = new Map(ctx.existingClients.map((c) => [c.id, c]));
  const existingInvoices = ctx.existingInvoices ?? new Map<string, ExistingInvoiceLite>();
  const usedMeterSeries = new Set(ctx.existingClients.map((c) => compactCode(c.meterSeries)).filter(Boolean));
  const consumedNames = new Set<string>();

  // Facturile cunoscute (existente + cele create în această rulare): numărul → luna, abonatul și, dacă există în bază, factura stocată.
  type Known = { issueDate: Date; name: string | null; stored?: ExistingInvoiceLite; clientId: string | null };
  const known = new Map<string, Known>();
  for (const [number, inv] of existingInvoices) {
    known.set(number, { issueDate: inv.issueDate, name: inv.consumerName ?? (inv.clientId ? clientById.get(inv.clientId)?.name ?? null : null), stored: inv, clientId: inv.clientId });
  }
  for (const number of ctx.existingInvoiceNumbers) if (!known.has(number)) known.set(number, { issueDate: new Date(0), name: null, clientId: null });
  const sameMonth = (x: Date, y: Date) => x.getUTCFullYear() === y.getUTCFullYear() && x.getUTCMonth() === y.getUTCMonth();

  const clientsToCreate: Prisma.ClientCreateManyInput[] = [];
  const clientUpdates: { id: string; data: Prisma.ClientUpdateInput }[] = [];
  const invoicesToCreate: Prisma.InvoiceCreateManyInput[] = [];
  const itemsToCreate: Prisma.InvoiceItemCreateManyInput[] = [];
  const invoiceUpdates: ApaCanalPlan["invoiceUpdates"] = [];
  const records: PlannedOneCRecord[] = [];
  const docs: ApaCanalDocOutcome[] = [];
  const usedUids = new Set<string>();
  // Acelaşi abonat de două ori în aceeași lună (o dublură în datele 1C: aceleași sume, doar indexul / volumul diferă): se folosește PRIMUL aviz din răspuns.
  // Se decide pe răspuns, nu pe baza de date — altfel la re-rulare al doilea aviz s-ar potrivi cu factura creată din primul și ar alterna valorile la fiecare sincronizare.
  const firstSeen = new Map<string, { number: string; clientId: string | null }>();
  // Cine apare în fiecare lună a răspunsului (cod → factură / client) — baza regulii „dispărut = sold zero”, vezi mai jos.
  const bySub = new Map<string, Map<string, SubInfo>>();
  const markSeen = (month: string, code: string, info: SubInfo) => {
    const m = bySub.get(month) ?? new Map<string, SubInfo>();
    if (!m.has(code)) m.set(code, info);
    bySub.set(month, m);
  };

  const buildItems = (invoiceId: string, a: OneCAviz): Prisma.InvoiceItemCreateManyInput[] =>
    avizServices(a).map((s, idx) => ({
      id: oid(),
      invoiceId,
      description: s.label,
      quantity: s.volum,
      unitPrice: s.tarif,
      taxRate: 0,
      lineSubtotal: s.suma,
      lineTotal: s.suma,
      position: idx,
    }));

  // Oglindă 1C → fișa plătitorului. Numele se suprascrie doar dacă 1C nu l-a pierdut („?” în loc de Ș/Ț) — la noi numele vin deja în UTF-8, dar păstrăm paza.
  type ClientChange = { camp: string; api: string; aplicatie: string };
  const mirrorClient = (
    c: ExistingClientLite,
    v: { name: string; phone?: string | null; email?: string | null; contract?: string | null; snapshot: { consumAddress: string | null; meterNumber: string | null; meterCurrReading: number | null; grandTotal: number; sectorNr?: string | null; estimated?: boolean | null } },
  ): { upd: Prisma.ClientUpdateInput; changes: ClientChange[] } => {
    const upd: Prisma.ClientUpdateInput = {};
    const changes: ClientChange[] = [];
    const chg = (camp: string, api: string, app: string | null | undefined) => changes.push({ camp: `Plătitor: ${camp}`, api, aplicatie: app || "—" });
    if (v.name && !v.name.includes("?") && v.name !== c.name) {
      chg("Nume", v.name, c.name);
      upd.name = v.name;
      c.name = v.name;
    }
    if (v.phone && v.phone !== (c.phone ?? null)) {
      chg("Telefon", v.phone, c.phone);
      upd.phone = v.phone;
      c.phone = v.phone;
    }
    if (v.email && v.email !== (c.email ?? null)) {
      chg("Email", v.email, c.email);
      upd.email = v.email;
      c.email = v.email;
    }
    if (v.contract && !c.apaCanalContract) {
      chg("Nr. contract", v.contract, null);
      upd.apaCanalContract = v.contract;
      c.apaCanalContract = v.contract;
    }
    const sn = v.snapshot;
    if (sn.sectorNr && sn.sectorNr !== (c.lastInvoiceSectorNr ?? null)) {
      chg("Sector", sn.sectorNr, c.lastInvoiceSectorNr);
      upd.lastInvoiceSectorNr = sn.sectorNr;
      c.lastInvoiceSectorNr = sn.sectorNr;
    }
    if (sn.estimated != null && sn.estimated !== (c.meterReadingEstimated ?? false)) {
      upd.meterReadingEstimated = sn.estimated;
      c.meterReadingEstimated = sn.estimated;
    }
    if (sn.consumAddress && sn.consumAddress !== (c.consumAddress ?? null)) {
      chg("Adresă", sn.consumAddress, c.consumAddress);
      upd.consumAddress = sn.consumAddress;
      c.consumAddress = sn.consumAddress;
    }
    if (sn.meterNumber && sn.meterNumber !== (c.meterNumber ?? null)) {
      chg("Nr. contor", sn.meterNumber, c.meterNumber);
      upd.meterNumber = sn.meterNumber;
      c.meterNumber = sn.meterNumber;
    }
    if (sn.meterCurrReading !== null && sn.meterCurrReading !== (c.meterCurrReading ?? null)) {
      chg("Citire curentă", String(sn.meterCurrReading), c.meterCurrReading == null ? null : String(c.meterCurrReading));
      upd.meterCurrReading = sn.meterCurrReading;
      c.meterCurrReading = sn.meterCurrReading;
    }
    if (Math.abs(sn.grandTotal - (c.lastInvoiceGrandTotal ?? 0)) > 0.005) {
      chg("Sold (MDL)", sn.grandTotal.toFixed(2), (c.lastInvoiceGrandTotal ?? 0).toFixed(2));
      upd.lastInvoiceGrandTotal = sn.grandTotal;
      c.lastInvoiceGrandTotal = sn.grandTotal;
    }
    return { upd, changes };
  };

  let skipped = 0;
  let meterSeriesCollisions = 0;
  let preservedActivated = 0;
  let skippedExistingInvoice = 0;

  for (const a of rows) {
    const name = str(a["Abonent"]);
    const code = compactCode(a["AbonentCod"]);
    const issueDate = avizIssueDate(a["Data"]);
    const month = avizMonth(a["Data"]);
    const amounts = avizAmounts(a);
    const meter = avizMeter(a);
    const apiValues = {
      calculat: amounts.total,
      datorie: amounts.datorieAvans,
      deAchitat: amounts.deAchitat,
      citirePrec: meter ? pad5(meter.prev) : null,
      citireCurenta: meter ? pad5(meter.curr) : null,
    };

    if (!issueDate || !month || !code) {
      skipped++;
      docs.push({ uid: "", number: null, name, contPersonal: code || null, period: month, status: "sarit", motiv: !code ? "Avizul nu are cod de abonat (AbonentCod gol)" : "Avizul nu are o dată validă (Data)", api: null });
      continue;
    }

    // Înregistrarea "Tabelul 1C": deterministă (cod + lună), deci aceeași sincronizare repetată o rescrie, nu o dublează.
    let uid = `${code}|${month}`;
    for (let n = 2; usedUids.has(uid); n++) uid = `${code}|${month}#${n}`;
    usedUids.add(uid);

    if (!name) {
      skipped++;
      docs.push({ uid, number: null, name: "", contPersonal: code, period: month, status: "sarit", motiv: "Abonatul nu are nume (Abonent gol)", api: apiValues });
      records.push({ ...buildOneCRecord(a, { uid, invoiceNumber: null }), clientId: null });
      markSeen(month, code, { number: "", clientId: null, name: "" }); // e în listă (deci are sold), doar că fără nume
      continue;
    }

    const dupKey = `${code}|${month}|${[...new Set(nameTokens(name))].sort().join(" ")}`;
    const first = firstSeen.get(dupKey);
    if (first) {
      skipped++;
      docs.push({ uid, number: first.number, name, contPersonal: code, period: month, status: "sarit", motiv: "Același abonat apare de două ori în aceeași lună — se folosește primul aviz (cel de-al doilea are doar alt index / volum)", api: apiValues });
      records.push({ ...buildOneCRecord(a, { uid, invoiceNumber: first.number }), clientId: first.clientId });
      continue;
    }

    const period = month.replace("-", "");
    const nameKey = norm(name);
    const consumAddress = avizAddress(a);
    const meterNumber = meter?.contor ?? null;
    const meterCurrReadingNum = meter ? meter.curr : null;
    const vol = round2(num(a["Volum"]));
    // Variabilele legate de utilizator (telefon, sector…): completate doar dacă 1C trimite câmpul legat și are valoare.
    const mv = mappedValues(a, ctx.mappings);
    const estimated = mv.readingSource == null ? null : isEstimatedReading(mv.readingSource);
    const recExtra = { telefon: mv.phone, inn: mv.idno, tipSector: mv.sector, sectorUchastok: mv.sector1c, nrContract: mv.contract, dataInstalare: mv.installDate, sursa: mv.readingSource };

    // Numărul facturii: primul candidat liber sau al acestui abonat din aceeași lună.
    let number = "";
    let mine: Known | null = null;
    for (let i = 0; i < 8 && !number; i++) {
      const cand = i === 0 ? `AC-${code}` : i === 1 ? `AC-${code}-${period}` : `AC-${code}-${period}-${i}`;
      const k = known.get(cand);
      if (!k) { number = cand; break; }
      if (sameMonth(k.issueDate, issueDate) && sameSubscriber(k.name, name)) { number = cand; mine = k; break; }
    }
    if (!number) number = `AC-${code}-${period}-${randomBytes(3).toString("hex")}`;

    const docBase = { uid, number, name, contPersonal: code, contract: null, period: month, api: apiValues };

    // Factura există deja (același abonat, aceeași lună): nu se creează alta. Dacă 1C trimite acum alte valori (plăți, recalcule, citiri, nr. contor…),
    // factura se ACTUALIZEAZĂ cu ele — altfel o corectură făcută în 1C n-ar ajunge niciodată în aplicație.
    if (mine) {
      skippedExistingInvoice++;
      const stored = mine.stored;
      const diffs: { camp: string; api: string; aplicatie: string }[] = [];
      let amountsChanged = false;
      if (stored?.id) {
        const meterKey = (v: string | null | undefined) => String(v ?? "").trim().replace(/^0+/, "");
        if (meterNumber && meterKey(meterNumber) !== meterKey(stored.meterNumber)) diffs.push({ camp: "Nr. contor", api: meterNumber, aplicatie: stored.meterNumber || "—" });
        const txt = (camp: string, api: string | null, app: string | null | undefined) => {
          if (api !== null && api !== (app ?? null)) diffs.push({ camp, api, aplicatie: app || "—" });
        };
        txt("Citire precedentă", apiValues.citirePrec, stored.meterPrevReading);
        txt("Citire curentă", apiValues.citireCurenta, stored.meterCurrReading);
        const numDiff = (camp: string, api: number, app: number | null | undefined) => {
          if (Math.abs(api - (app ?? 0)) > 0.005) { diffs.push({ camp, api: api.toFixed(2), aplicatie: (app ?? 0).toFixed(2) }); amountsChanged = true; }
        };
        numDiff("Calculat (MDL)", amounts.total, stored.subtotal);
        numDiff("Datorie/avans (MDL)", amounts.datorieAvans, stored.datoriiAvans);
        numDiff("Recalcul (MDL)", amounts.recalc, stored.recalculari);
        numDiff("De achitat (MDL)", amounts.deAchitat, stored.grandTotal);
        txt("Adresă consum", consumAddress, stored.consumAddress);
        txt("Sector", mv.sector, stored.sectorNr);
        if (name && !name.includes("?") && name !== (stored.consumerName ?? null)) diffs.push({ camp: "Nume", api: name, aplicatie: stored.consumerName || "—" });
      }
      // Fișa plătitorului: oglindă 1C (doar de la cea mai nouă factură a lui — o lună veche are date vechi), independent de diferențele facturii.
      const owner = stored?.clientId ? clientById.get(stored.clientId) : undefined;
      let ownerChanges: ClientChange[] = [];
      if (owner && (!owner.lastInvoiceIssueDate || issueDate >= owner.lastInvoiceIssueDate)) {
        const m = mirrorClient(owner, { name, phone: mv.phone, email: mv.email, contract: mv.contract, snapshot: { consumAddress, meterNumber, meterCurrReading: meterCurrReadingNum, grandTotal: amounts.deAchitat, sectorNr: mv.sector, estimated } });
        ownerChanges = m.changes;
        if (Object.keys(m.upd).length) clientUpdates.push({ id: owner.id, data: m.upd });
      }
      if (stored?.id && diffs.length) {
        invoiceUpdates.push({
          id: stored.id,
          data: {
            ...(meterNumber ? { meterNumber } : {}),
            meterPrevReading: apiValues.citirePrec,
            meterCurrReading: apiValues.citireCurenta,
            subtotal: amounts.total,
            datoriiAvans: amounts.datorieAvans,
            recalculari: amounts.recalc,
            grandTotal: amounts.deAchitat,
            dueDate: dueDateFrom(stored.issueDate),
            ...(consumAddress ? { consumAddress } : {}),
            ...(name && !name.includes("?") ? { consumerName: name } : {}),
            ...(mv.sector ? { sectorNr: mv.sector } : {}),
            ...(estimated != null ? { isEstimatedVolume: estimated } : {}),
            monthlyConsumption: vol > 0 ? [{ label: String(issueDate.getUTCMonth() + 1), value: vol }] : [],
          },
          items: amountsChanged ? buildItems(stored.id, a) : null,
        });
        docs.push({ ...docBase, status: "actualizat", diffs: [...diffs, ...ownerChanges] });
      } else if (ownerChanges.length) {
        docs.push({ ...docBase, status: "actualizat", diffs: ownerChanges });
      } else {
        docs.push({ ...docBase, status: "existent" });
      }
      records.push({ ...buildOneCRecord(a, { uid, invoiceNumber: number }, recExtra), clientId: stored?.clientId ?? null });
      firstSeen.set(dupKey, { number, clientId: stored?.clientId ?? null });
      markSeen(month, code, { number, clientId: stored?.clientId ?? null, name });
      continue;
    }

    // Clientul: (1) cel cu același cod ȘI același nume, (2) un client din CRM fără identitate 1C cu același nume. Un client cu același cod dar alt nume
    // NU e potrivit (alt om / alt operator).
    let existing: ExistingClientLite | undefined;
    const bySeries = clientBySeries.get(code);
    if (bySeries && sameSubscriber(bySeries.name, name)) existing = bySeries;
    const matchedByIdentity = !!existing;
    if (!existing && !consumedNames.has(nameKey)) {
      existing = clientsByNameKey.get(nameKey)?.find((c) => !c.meterSeries && !c.apaCanalContract);
    }

    let meterSeries: string | null = null;
    if (existing && compactCode(existing.meterSeries) === code) meterSeries = code; // deja al lui
    else if (!usedMeterSeries.has(code)) meterSeries = code;
    else meterSeriesCollisions++;

    // Calculat aici — Client.lastInvoice* trebuie populat direct la import, ca /platitori (sold, status) să nu depindă de o reîmprospătare ulterioară.
    const subtotal = amounts.total;
    const datoriiAvans = amounts.datorieAvans;
    const grandTotal = amounts.deAchitat;

    let clientId: string;
    if (existing) {
      if (!matchedByIdentity) consumedNames.add(nameKey);
      clientId = existing.id;
      // Un import dintr-o perioadă mai veche nu are voie să dea înapoi instantaneul "ultima factură".
      const newest = !existing.lastInvoiceIssueDate || issueDate >= existing.lastInvoiceIssueDate;
      const upd: Prisma.ClientUpdateInput = {
        consumAddress: consumAddress ?? undefined,
        ...(newest
          ? {
              meterNumber,
              meterCurrReading: meterCurrReadingNum,
              meterReadingEstimated: estimated ?? false,
              lastInvoiceStatus: "SENT" as const,
              lastInvoiceGrandTotal: grandTotal,
              lastInvoiceIssueDate: issueDate,
            }
          : {}),
      };
      existing.lastInvoiceIssueDate = newest ? issueDate : existing.lastInvoiceIssueDate;
      if (existing.portalActivatedAt) {
        preservedActivated++;
      } else if (meterSeries && meterSeries !== existing.meterSeries) {
        upd.meterSeries = meterSeries;
        if (existing.meterSeries) usedMeterSeries.delete(compactCode(existing.meterSeries));
        usedMeterSeries.add(meterSeries);
        existing.meterSeries = meterSeries;
        clientBySeries.set(meterSeries, existing);
      }
      if (newest) Object.assign(upd, mirrorClient(existing, { name, phone: mv.phone, email: mv.email, contract: mv.contract, snapshot: { consumAddress, meterNumber, meterCurrReading: meterCurrReadingNum, grandTotal, sectorNr: mv.sector, estimated } }).upd);
      clientUpdates.push({ id: existing.id, data: upd });
    } else {
      clientId = oid();
      if (meterSeries) usedMeterSeries.add(meterSeries);
      clientsToCreate.push({
        id: clientId,
        userId: ctx.ownerId,
        name,
        phone: mv.phone,
        email: mv.email,
        apaCanalContract: mv.contract,
        meterSeries,
        meterNumber,
        meterCurrReading: meterCurrReadingNum,
        meterReadingEstimated: estimated ?? false,
        consumAddress,
        lastInvoiceStatus: "SENT",
        lastInvoiceGrandTotal: grandTotal,
        lastInvoiceSectorNr: mv.sector,
        lastInvoiceIssueDate: issueDate,
        apaCanalImport: !meterSeries,
      });
      const created: ExistingClientLite = {
        id: clientId, name, phone: mv.phone, email: mv.email, apaCanalContract: mv.contract, meterSeries, portalActivatedAt: null, lastInvoiceIssueDate: issueDate, lastInvoiceSectorNr: mv.sector, consumAddress, meterNumber, meterCurrReading: meterCurrReadingNum, lastInvoiceGrandTotal: grandTotal,
      };
      clientsByNameKey.set(nameKey, [...(clientsByNameKey.get(nameKey) ?? []), created]);
      clientById.set(clientId, created);
      if (meterSeries) clientBySeries.set(meterSeries, created);
      consumedNames.add(nameKey);
    }

    known.set(number, { issueDate, name, clientId });
    firstSeen.set(dupKey, { number, clientId });
    markSeen(month, code, { number, clientId, name });
    docs.push({ ...docBase, status: "nou", clientNou: !existing });

    const invoiceId = oid();
    invoicesToCreate.push({
      id: invoiceId,
      number,
      status: "SENT",
      kind: "APA_CANAL",
      issueDate,
      dueDate: dueDateFrom(issueDate),
      contPersonal: code,
      consumAddress,
      consumerName: name,
      meterNumber,
      meterPrevReading: apiValues.citirePrec,
      meterCurrReading: apiValues.citireCurenta,
      isEstimatedVolume: estimated ?? false,
      sectorNr: mv.sector,
      billingPeriodLabel: `${LUNI_RO[issueDate.getUTCMonth()]} ${issueDate.getUTCFullYear()}`,
      recalculari: amounts.recalc,
      penalitati: 0,
      datoriiAvans,
      monthlyConsumption: vol > 0 ? [{ label: String(issueDate.getUTCMonth() + 1), value: vol }] : [],
      clientId,
      currency: "MDL",
      subtotal,
      taxTotal: 0,
      grandTotal,
      publicToken: genToken(),
      userId: ctx.ownerId,
    });
    itemsToCreate.push(...buildItems(invoiceId, a));
    records.push({ ...buildOneCRecord(a, { uid, invoiceNumber: number }, recExtra), clientId });
  }

  // „Dispărut din luna următoare = sold zero”. Noul 1C scoate din listă abonații al căror „Total spre plată” e ≤ 0 (verificat pe date reale: în nicio lună nu apare vreunul cu sold ≤ 0,
  // iar cei care reapar au sold inițial zero sau avans, niciodată datorie). Deci un abonat care a achitat tot dispare — nu are o „factură următoare” din care să deducem plata,
  // iar factura lui ar rămâne „Trimisă” pe veci, cu soldul vechi în Plătitori. Aici o marcăm Achitată și punem soldul clientului pe 0.
  // Doar între luni consecutive și doar dacă luna nouă pare completă (nu mult mai puțini abonați decât cea veche) — altfel un răspuns trunchiat ar „achita” mii de facturi.
  let settledFromAbsence = 0;
  const months = [...bySub.keys()].sort();
  const monthIssueEnd = (m: string) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo, 0, 12, 0, 0)); };
  const pairs: { prev: string; prevSubs: Map<string, SubInfo>; cur: string }[] = [];
  const first = months[0];
  if (first && ctx.prevMonth && ctx.prevMonth.month === prevMonthKey(first)) pairs.push({ prev: ctx.prevMonth.month, prevSubs: ctx.prevMonth.subs, cur: first });
  for (let i = 1; i < months.length; i++) if (months[i] === nextMonthKey(months[i - 1])) pairs.push({ prev: months[i - 1], prevSubs: bySub.get(months[i - 1])!, cur: months[i] });
  const inRun = new Map(invoicesToCreate.map((i) => [i.number, i]));
  for (const { prev, prevSubs, cur } of pairs) {
    const curSubs = bySub.get(cur)!;
    if (prevSubs.size >= 50 && curSubs.size < prevSubs.size * 0.5) {
      docs.push({ uid: "", number: null, name: "", contPersonal: null, period: cur, status: "sarit", motiv: `Luna ${cur} are doar ${curSubs.size} abonați față de ${prevSubs.size} în ${prev} — nu s-a marcat nicio factură achitată (răspuns incomplet?)`, api: null });
      continue;
    }
    const paidAt = monthIssueEnd(cur);
    for (const [code, info] of prevSubs) {
      if (curSubs.has(code) || !info.number) continue;
      const stored = known.get(info.number)?.stored;
      const fresh = inRun.get(info.number);
      const was = fresh ? fresh.status : stored?.status;
      if (!was || was === "PAID" || was === "CANCELLED" || was === "DRAFT") continue;
      if (fresh) {
        fresh.status = "PAID";
        fresh.paidAt = paidAt;
      } else if (stored?.id) {
        const upd = invoiceUpdates.find((u) => u.id === stored.id);
        if (upd) Object.assign(upd.data, { status: "PAID", paidAt });
        else invoiceUpdates.push({ id: stored.id, data: { status: "PAID", paidAt }, items: null });
      } else continue;
      // soldul plătitorului: doar dacă factura asta e ultima lui (nu a venit între timp una mai nouă)
      const c = info.clientId ? clientById.get(info.clientId) : undefined;
      if (c && c.lastInvoiceIssueDate && c.lastInvoiceIssueDate.toISOString().slice(0, 7) === prev) {
        clientUpdates.push({ id: c.id, data: { lastInvoiceStatus: "PAID", lastInvoiceGrandTotal: 0 } });
        c.lastInvoiceGrandTotal = 0;
      }
      settledFromAbsence++;
      docs.push({
        uid: "", number: info.number, name: info.name, contPersonal: code, period: prev, status: "actualizat",
        diffs: [{ camp: "Status factură", api: `Achitată — nu mai apare în 1C în ${cur} (sold zero)`, aplicatie: was === "OVERDUE" ? "Restantă" : "Trimisă" }],
        api: null,
      });
    }
  }

  const totalNecuvenit = round2(invoicesToCreate.reduce((s, i) => s + (i.subtotal as number), 0));
  const totalDePlata = round2(invoicesToCreate.reduce((s, i) => s + (i.grandTotal as number), 0));

  return {
    clientsToCreate,
    clientUpdates,
    invoicesToCreate,
    itemsToCreate,
    docs,
    invoiceUpdates,
    records,
    stats: {
      documenteTotale: rows.length,
      sariteFaraAbonent: skipped,
      clientiNoiDeCreat: clientsToCreate.length,
      clientiExistentiActualizati: clientUpdates.length,
      dinCareCuContActivatPastrat: preservedActivated,
      coliziuniContPersonal: meterSeriesCollisions,
      facturiDeCreat: invoicesToCreate.length,
      facturiSaritePreexistente: skippedExistingInvoice,
      facturiActualizate: invoiceUpdates.length,
      facturiAchitateDinAbsenta: settledFromAbsence,
      liniiFacturaDeCreat: itemsToCreate.length,
      totalNecuvenit,
      totalDePlata,
    },
  };
}

const CHUNK = 1000;

async function chunkedCreateMany<T>(
  createMany: (args: { data: T[] }) => Promise<{ count: number }>,
  rows: T[],
): Promise<number> {
  let created = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const res = await createMany({ data: rows.slice(i, i + CHUNK) });
    created += res.count;
  }
  return created;
}

export type ApaCanalApplyResult = {
  clientsCreated: number;
  clientsUpdated: number;
  invoicesCreated: number;
  itemsCreated: number;
  invoicesUpdated: number;
};

// Interfață minimală, scrisă de mână (NU derivată din PrismaClient) — clientul din
// lib/prisma.ts e rezultatul unui $extends() ale cărui delegate-uri au un tip generic intern
// diferit de PrismaClient brut și nu se potrivesc structural cu Pick<PrismaClient, ...>, deși
// la runtime metodele chemate aici (createMany/update) au exact aceeași semnătură funcțională.
type ApaCanalPrisma = {
  client: {
    createMany(args: { data: Prisma.ClientCreateManyInput[] }): Promise<{ count: number }>;
  };
  invoice: {
    createMany(args: { data: Prisma.InvoiceCreateManyInput[] }): Promise<{ count: number }>;
    update(args: { where: { id: string }; data: Prisma.InvoiceUpdateInput }): Promise<unknown>;
  };
  invoiceItem: {
    createMany(args: { data: Prisma.InvoiceItemCreateManyInput[] }): Promise<{ count: number }>;
    deleteMany(args: { where: { invoiceId: string } }): Promise<{ count: number }>;
  };
  $runCommandRaw(command: object): Promise<unknown>;
};

/** `Date` → EJSON `{$date}` (altfel ajunge string simplu în Mongo, nefiltrabil ca dată la citire);
 * restul valorilor merg ca atare. `undefined` e omis explicit din `$set` (nu doar lăsat să cadă la
 * JSON.stringify), ca intenția „nu atinge câmpul ăsta" să rămână clară. */
function toSetDoc(data: Record<string, unknown>): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    set[k] = v instanceof Date ? { $date: v.toISOString() } : v;
  }
  return set;
}

/**
 * Actualizează clienții existenți printr-o singură comandă nativă MongoDB `update` per lot (bulk,
 * un round-trip pentru mii de actualizări), nu câte un apel Prisma per client. La ~18.700 clienți
 * de actualizat, varianta anterioară (update() individual, 50 în paralel) a dus sincronizarea peste
 * limita de 300 s a funcției Vercel — timeout real, observat 2026-10-10 (log: "Task timed out after
 * 300 seconds"), care lăsa și blocarea de sincronizare agățată 10 minute (vezi acquireSyncLock),
 * fiindcă un kill forțat de platformă sare peste blocul `finally` care ar fi eliberat-o.
 */
async function bulkUpdateClients(
  prisma: ApaCanalPrisma,
  updates: { id: string; data: Prisma.ClientUpdateInput }[],
): Promise<number> {
  if (!updates.length) return 0;
  const CHUNK = 2000;
  let modified = 0;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const slice = updates.slice(i, i + CHUNK);
    const res = (await prisma.$runCommandRaw({
      update: "Client",
      updates: slice.map((u) => ({
        q: { _id: { $oid: u.id } },
        u: { $set: toSetDoc(u.data as Record<string, unknown>) },
      })),
      ordered: false,
    })) as { n?: number; nModified?: number };
    modified += res.nModified ?? res.n ?? slice.length;
  }
  // comanda nativă ocolește extensia Prisma: listele din memorie care depind de clienți (lista de clienți, căutarea după nume / telefon) trebuie marcate depășite aici
  bumpClientEpoch();
  bumpClientSearchEpoch();
  return modified;
}

type OneCPrisma = {
  oneCRecord: {
    deleteMany(args: { where: { uid: { in: string[] } } }): Promise<{ count: number }>;
    createMany(args: { data: Prisma.OneCRecordCreateManyInput[] }): Promise<{ count: number }>;
  };
};

/**
 * Păstrează "Tabelul 1C" (colecția OneCRecord, câte o înregistrare per aviz) în pas cu fiecare import: înlocuiește înregistrările avizelor din răspuns (aceleași UID-uri
 * „cod|lună”). Rulat după applyApaCanalPlan. Înregistrările vechi (UID 1C din exportul cu 6 tabele) nu se ating.
 */
export async function syncOneCRecords(prisma: OneCPrisma, records: PlannedOneCRecord[]): Promise<number> {
  // Loturi de câte 500 de UID-uri (fiecare: șterge vechile + inserează noile), câte 4 în paralel — loturile au UID-uri diferite, deci nu se calcă între ele.
  const BATCH = 500;
  const PARALLEL = 4;
  const chunks: PlannedOneCRecord[][] = [];
  for (let i = 0; i < records.length; i += BATCH) chunks.push(records.slice(i, i + BATCH));
  let written = 0;
  for (let i = 0; i < chunks.length; i += PARALLEL) {
    const counts = await Promise.all(
      chunks.slice(i, i + PARALLEL).map(async (slice) => {
        await prisma.oneCRecord.deleteMany({ where: { uid: { in: slice.map((r) => r.uid) } } });
        const res = await prisma.oneCRecord.createMany({
          data: slice.map((r) => ({
            ...r,
            raw: r.raw as unknown as Prisma.InputJsonValue,
            consumers: r.consumers as unknown as Prisma.InputJsonValue,
            meters: r.meters as unknown as Prisma.InputJsonValue,
            readings: r.readings as unknown as Prisma.InputJsonValue,
            lines: r.lines as unknown as Prisma.InputJsonValue,
          })),
        });
        return res.count;
      }),
    );
    written += counts.reduce((x, y) => x + y, 0);
  }
  return written;
}

/**
 * Pipeline-ul complet, comun importului din fișier și sincronizării din API: parsare → plan → (opțional) scriere + Tabelul 1C.
 * Fără `commit` doar calculează planul (statistici), fără nicio scriere. Un eșec la Tabelul 1C nu strică importul deja scris — doar se raportează în log.
 */
export async function importApaCanalBuffer(buf: Buffer, opts: { ownerId: string; commit: boolean }) {
  const data = parseApaCanalBuffer(buf);
  if (data.length === 0) {
    throw new Error("1C n-a trimis niciun aviz de plată pentru perioada cerută. Luna curentă apare abia după ce se închide; verifică și că fișierul / linkul e al lunii dorite.");
  }

  const [existingClients, existingInvoices] = await Promise.all([
    // Toți clienții, nu doar ai utilizatorului care rulează importul: aplicația e a unei singure firme, iar plătitorii aparțin
    // celui care i-a importat prima dată — altfel, la o sincronizare pornită de altcineva, toți ar părea "noi" și s-ar dubla.
    prisma.client.findMany({
      select: {
        id: true, name: true, phone: true, email: true, meterSeries: true, portalActivatedAt: true, lastInvoiceIssueDate: true, apaCanalContract: true,
        consumAddress: true, meterNumber: true, meterCurrReading: true, meterReadingEstimated: true, lastInvoiceGrandTotal: true, lastInvoiceSectorNr: true,
      },
    }),
    prisma.invoice.findMany({
      select: {
        id: true, number: true, clientId: true, issueDate: true, meterNumber: true, meterPrevReading: true,
        meterCurrReading: true, subtotal: true, datoriiAvans: true, recalculari: true, grandTotal: true, dueDate: true,
        consumAddress: true, consumerName: true, sectorNr: true, isEstimatedVolume: true, metersSig: true, status: true,
      },
    }),
  ]);

  // Abonații din luna dinaintea primei luni din răspuns (ca să știm cine a dispărut din ea) — doar din înregistrările noului 1C (uid „cod|lună”), nu din ale vechiului operator.
  let prevMonth: { month: string; subs: Map<string, SubInfo> } | undefined;
  const firstMonth = data.map((a) => avizMonth(a["Data"])).filter((m): m is string => !!m).sort()[0];
  if (firstMonth) {
    const month = prevMonthKey(firstMonth);
    const recs = await prisma.oneCRecord.findMany({
      where: { dataDoc: { startsWith: month }, uid: { contains: "|" } },
      select: { contPersonal: true, invoiceNumber: true, clientId: true, nume: true },
    });
    if (recs.length) {
      const subs = new Map<string, SubInfo>();
      for (const r of recs) if (r.contPersonal && !subs.has(r.contPersonal)) subs.set(r.contPersonal, { number: r.invoiceNumber ?? "", clientId: r.clientId, name: r.nume ?? "" });
      prevMonth = { month, subs };
    }
  }

  // Legăturile făcute în Setări → Mapare 1C (variabilă a aplicației → câmp 1C); fără ele, doar câmpurile fixe se completează.
  const mappings = cleanMappings(Object.fromEntries((await prisma.oneCMapping.findMany({ select: { appField: true, source: true } })).map((m) => [m.appField, m.source])));

  const plan = buildApaCanalPlan(data, {
    ownerId: opts.ownerId,
    prevMonth,
    mappings,
    existingClients,
    existingInvoiceNumbers: new Set(existingInvoices.map((i) => i.number)),
    existingInvoices: new Map(existingInvoices.map((i) => [i.number, i])),
  });
  if (!opts.commit) return { data, plan, applied: null as ApaCanalApplyResult | null };

  const applied = await applyApaCanalPlan(prisma, plan);
  (await import("../portal-cache")).bumpPortalEpoch(); // facturile și contoarele tuturor clienților s-au putut schimba: portalul le citește din nou
  try {
    await syncOneCRecords(prisma, plan.records);
    // Lista de contoare (/contoare) se construiește din aceste înregistrări: o reconstruim în fundal.
    await import("./meter-cache").then((m) => m.invalidateMeters()).catch((e) => console.error("[apa-canal-import] nu am putut marca lista de contoare:", e));
  } catch (e) {
    console.error("[apa-canal-import] sincronizarea Tabelului 1C a eșuat:", e);
  }
  return { data, plan, applied };
}

export type SyncReportDiff = { camp: string; api: string; aplicatie: string };
export type SyncReportRow = {
  number: string | null;
  name: string;
  contPersonal: string | null;
  contract?: string | null;
  period: string | null;
  deAchitat: number | null;
  clientNou?: boolean;
  motiv?: string;
  diffs?: SyncReportDiff[];
};
export type SyncReport = {
  /** Câte avize a trimis 1C pe fiecare lună din răspuns. */
  tabele: { nume: string; ro: string; randuri: number }[];
  documenteUnice: number;
  documenteRepetate: number;
  counts: { noi: number; noiCuClientNou: number; identice: number; diferite: number; sarite: number };
  noi: SyncReportRow[];
  diferite: SyncReportRow[];
  identice: SyncReportRow[];
  sarite: SyncReportRow[];
  /** Listele de mai sus sunt tăiate la LIST_LIMIT rânduri, ca răspunsul să rămână mic la mii de abonați. */
  limita: number;
};

const REPORT_LIST_LIMIT = 300;

/**
 * Raportul detaliat pentru "Sincronizare API": pentru fiecare aviz din API — factură nouă, factură deja existentă IDENTICĂ, deja existentă dar cu valori DIFERITE (care anume),
 * sau sărit (de ce). Comparația cu facturile existente se face deja în buildApaCanalPlan (în memorie) — aici nu mai citim nimic din bază.
 */
export async function buildSyncReport(data: ApaCanalRawData, plan: ApaCanalPlan): Promise<SyncReport> {
  const noi: SyncReportRow[] = [];
  const diferite: SyncReportRow[] = [];
  const identice: SyncReportRow[] = [];
  const sarite: SyncReportRow[] = [];
  let noiCuClientNou = 0;

  for (const d of plan.docs) {
    const base: SyncReportRow = { number: d.number, name: d.name, contPersonal: d.contPersonal, contract: d.contract ?? null, period: d.period, deAchitat: d.api?.deAchitat ?? null };
    if (d.status === "sarit") {
      sarite.push({ ...base, motiv: d.motiv });
    } else if (d.status === "nou") {
      if (d.clientNou) noiCuClientNou++;
      noi.push({ ...base, clientNou: d.clientNou });
    } else if (d.status === "actualizat") {
      diferite.push({ ...base, diffs: d.diffs });
    } else {
      identice.push(base);
    }
  }

  const perLuna = new Map<string, number>();
  for (const a of data) {
    const m = avizMonth(a["Data"]) ?? "fără dată";
    perLuna.set(m, (perLuna.get(m) ?? 0) + 1);
  }
  const tabele = [...perLuna.entries()]
    .sort((x, y) => x[0].localeCompare(y[0]))
    .map(([luna, randuri]) => ({ nume: luna, ro: "Avize de plată", randuri }));

  return {
    tabele,
    documenteUnice: plan.docs.length,
    documenteRepetate: Math.max(0, data.length - plan.docs.length),
    counts: { noi: noi.length, noiCuClientNou, identice: identice.length, diferite: diferite.length, sarite: sarite.length },
    noi: noi.slice(0, REPORT_LIST_LIMIT),
    diferite: diferite.slice(0, REPORT_LIST_LIMIT),
    identice: identice.slice(0, REPORT_LIST_LIMIT),
    sarite: sarite.slice(0, REPORT_LIST_LIMIT),
    limita: REPORT_LIST_LIMIT,
  };
}

/** Scrie planul efectiv în bază (în loturi). */
export async function applyApaCanalPlan(
  prisma: ApaCanalPrisma,
  plan: ApaCanalPlan,
): Promise<ApaCanalApplyResult> {
  const clientsCreated = await chunkedCreateMany(
    (args) => prisma.client.createMany(args),
    plan.clientsToCreate,
  );

  const clientsUpdated = await bulkUpdateClients(prisma, plan.clientUpdates);

  const invoicesCreated = await chunkedCreateMany(
    (args) => prisma.invoice.createMany(args),
    plan.invoicesToCreate,
  );
  const itemsCreated = await chunkedCreateMany(
    (args) => prisma.invoiceItem.createMany(args),
    plan.itemsToCreate,
  );

  // Facturi existente cu date corectate în 1C: câmpurile noi + (dacă s-au schimbat sumele) liniile de calcul refăcute.
  let invoicesUpdated = 0;
  for (let i = 0; i < plan.invoiceUpdates.length; i += 25) {
    const slice = plan.invoiceUpdates.slice(i, i + 25);
    await Promise.all(
      slice.map(async (u) => {
        await prisma.invoice.update({ where: { id: u.id }, data: u.data });
        if (u.items) {
          await prisma.invoiceItem.deleteMany({ where: { invoiceId: u.id } });
          if (u.items.length) await prisma.invoiceItem.createMany({ data: u.items });
        }
      }),
    );
    invoicesUpdated += slice.length;
  }

  return { clientsCreated, clientsUpdated, invoicesCreated, itemsCreated, invoicesUpdated };
}
