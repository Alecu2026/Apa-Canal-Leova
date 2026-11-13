import "server-only";
import { prisma } from "../prisma";
import { cleanMappings, KNOWN_1C_FIELDS, MAPPABLE_KEYS } from "../onec-map";

/**
 * Legăturile dintre variabilele aplicației și câmpurile din răspunsul 1C (Setări → Mapare 1C) + ce a trimis 1C de fapt (din avizele salvate în Tabelul 1C):
 * câmpurile care apar în răspuns, un exemplu de valoare și cât la sută din abonați îl au completat. Câmpurile noi pe care 1C le adaugă ulterior apar singure
 * în listă, la prima sincronizare după adăugare.
 */

export async function getMappings(): Promise<Record<string, string>> {
  const rows = await prisma.oneCMapping.findMany({ select: { appField: true, source: true } });
  return cleanMappings(Object.fromEntries(rows.map((r) => [r.appField, r.source])));
}

/** Leagă (sau, cu `source` null, dezleagă) o variabilă a aplicației de un câmp 1C. Doar variabilele „legabile”. */
export async function saveMapping(appField: string, source: string | null, userId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!MAPPABLE_KEYS.includes(appField)) return { ok: false, error: "Variabila aceasta e fixă (legată în cod) sau locală — nu se poate lega din pagină." };
  const src = (source ?? "").trim();
  if (src.length > 80) return { ok: false, error: "Numele câmpului 1C e prea lung." };
  if (!src) {
    await prisma.oneCMapping.deleteMany({ where: { appField } });
  } else {
    await prisma.oneCMapping.upsert({
      where: { appField },
      create: { appField, source: src, updatedById: userId },
      update: { source: src, updatedById: userId },
    });
  }
  // Un răspuns identic cu cel de data trecută nu se mai prelucrează (vezi cron-ul): după o schimbare de legături trebuie prelucrat din nou.
  await prisma.apiIntegration.updateMany({ where: { key: "apa-canal-1c" }, data: { lastContentHash: null } });
  return { ok: true };
}

export type OneCFieldInfo = {
  key: string;
  label: string;
  group: string;
  /** false = câmp venit de la 1C care nu e în lista cunoscută (1C a adăugat ceva nou). */
  known: boolean;
  /** Un exemplu de valoare (primul nevid din eșantion) sau null dacă nu s-a văzut încă în date. */
  sample: string | null;
  /** Cât din eșantion are câmpul completat (0–1); null = nu există date încă. */
  fill: number | null;
};

export type MappingOverview = {
  mappings: Record<string, string>;
  fields: OneCFieldInfo[];
  /** Câte avize au fost citite pentru statistici, din ce lună (null = încă nu s-a făcut nicio sincronizare). */
  sampled: number;
  month: string | null;
};

const SAMPLE = 1500;

export async function getMappingOverview(): Promise<MappingOverview> {
  const [mappings, recs] = await Promise.all([
    getMappings(),
    prisma.oneCRecord
      .findMany({ where: { uid: { contains: "|" } }, orderBy: { dataDoc: "desc" }, take: SAMPLE, select: { raw: true, dataDoc: true } })
      .catch(() => [] as { raw: unknown; dataDoc: string | null }[]),
  ]);

  const nonEmpty = new Map<string, number>();
  const sample = new Map<string, string>();
  const seen = new Set<string>();
  let n = 0;
  for (const r of recs) {
    const raw = r.raw && typeof r.raw === "object" && !Array.isArray(r.raw) ? (r.raw as Record<string, unknown>) : null;
    if (!raw) continue;
    n++;
    for (const [k, v] of Object.entries(raw)) {
      seen.add(k);
      const s = String(v ?? "").replace(/\s+/g, " ").trim();
      if (!s) continue;
      nonEmpty.set(k, (nonEmpty.get(k) ?? 0) + 1);
      if (!sample.has(k) && s !== "0") sample.set(k, s.slice(0, 60));
    }
  }

  const info = (key: string, label: string, group: string, known: boolean): OneCFieldInfo => ({
    key, label, group, known,
    sample: sample.get(key) ?? null,
    fill: n ? (nonEmpty.get(key) ?? 0) / n : null,
  });
  const knownKeys = new Set(KNOWN_1C_FIELDS.map((f) => f.key));
  const fields = [
    ...KNOWN_1C_FIELDS.map((f) => info(f.key, f.label, f.group, true)),
    ...[...seen].filter((k) => !knownKeys.has(k)).sort().map((k) => info(k, "Câmp nou venit de la 1C", "Câmpuri noi", false)),
  ];
  return { mappings, fields, sampled: n, month: recs[0]?.dataDoc?.slice(0, 7) ?? null };
}
