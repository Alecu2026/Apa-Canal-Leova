import { getT } from "@/lib/i18n/server-t";
import { getPayerOneCRecords, type PayerOneCRecord } from "@/lib/queries/payers";
import { ONEC_COLUMNS, type OneCColumn } from "@/lib/apa-canal-1c";
import OneCMissingNotice from "./OneCMissingNotice";

const COL = new Map<string, OneCColumn>(ONEC_COLUMNS.map((c) => [c.key, c]));
const INDEX_KEYS = new Set(["citirePrec", "citireCurenta", "consumTotal"]);
const nf = (n: number) => n.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (c: OneCColumn, v: string | number | null | undefined): string => {
  if (v === null || v === undefined || v === "") return "—";
  if (c.type === "num") {
    if (!Number.isFinite(Number(v))) return String(v);
    // indexurile contorului și volumul: fără zecimale forțate (1314, nu 1.314,00)
    return INDEX_KEYS.has(c.key) ? Number(v).toLocaleString("ro-RO", { maximumFractionDigits: 3 }) : nf(Number(v));
  }
  if (c.type === "date") {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
    return m ? `${m[3]}.${m[2]}.${m[1]}` : String(v);
  }
  return String(v);
};
const TH = "px-2.5 py-1 text-left text-[11px] font-semibold text-ink-soft";
const TD = "whitespace-nowrap px-2.5 py-1";

/** Câmpurile avizului care nu sunt pe serviciu (afișate ca listă): identificare, adresă, contor. */
const INFO_KEYS = ["nume", "contPersonal", "strada", "casa", "apartament", "dataDoc", "lunaViitoare", "contorActiv", "sigiliu", "citirePrec", "citireCurenta", "consumTotal"];
/** Totalurile lunii. */
const TOTAL_KEYS = ["calculat", "soldInit", "platit", "recalc", "datorieAvans", "deAchitat"];
/** Serviciile: (cheie, etichetă, cheia cotei, dacă are cotă). */
const SERVICES: { k: string; label: string; rate?: string }[] = [
  { k: "apa", label: "Apă", rate: "apaTarif" },
  { k: "canal", label: "Canalizare", rate: "canalTarif" },
  { k: "gunoi", label: "Gunoi" },
  { k: "to", label: "TO", rate: "toTarif" },
  { k: "apartament", label: "Apartament" },
];

function Item({ k, rec }: { k: string; rec: PayerOneCRecord }) {
  const c = COL.get(k);
  if (!c) return null;
  return (
    <div className="min-w-0" title={`1C: ${c.src}`}>
      <dt className="text-[11px] text-ink-soft">{c.label}</dt>
      <dd className="truncate font-medium tabular-nums">{fmt(c, rec[k])}</dd>
    </div>
  );
}

/**
 * Secțiunea „Date din 1C” de pe fișa plătitorului: ultimul aviz cu TOATE câmpurile (totaluri, defalcare pe servicii, contor), istoricul avizelor pe luni
 * și lista a ce date NU vin din 1C. Datele sunt cele din Tabelul 1C (colecția OneCRecord), deci apar după sincronizarea cu 1C.
 */
export default async function PayerOneCData({ clientId }: { clientId: string }) {
  const [tr, recs] = await Promise.all([getT(), getPayerOneCRecords(clientId).catch(() => [] as PayerOneCRecord[])]);
  const last = recs[0];

  return (
    <div>
      {!last ? (
        <p className="p-4 text-center text-sm text-ink-soft">{tr("Niciun aviz 1C pentru acest plătitor încă — apare după sincronizarea cu 1C (Plătitori → Sincronizare API).")}</p>
      ) : (
        <div className="flex flex-col gap-3 p-3">
          <p className="text-xs text-ink-soft">
            {tr("Ultimul aviz 1C")}: <b>{fmt(COL.get("dataDoc")!, last.dataDoc)}</b> · {tr("trecut cu mouse-ul peste un câmp vezi numele lui din 1C")}
          </p>

          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[13px] sm:grid-cols-3">
            {INFO_KEYS.map((k) => <Item key={k} k={k} rec={last} />)}
          </dl>

          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-lg bg-[var(--color-surface-2)] p-2.5 text-[13px] sm:grid-cols-3">
            {TOTAL_KEYS.map((k) => <Item key={k} k={k} rec={last} />)}
          </dl>

          <div className="overflow-auto">
            <table className="w-full min-w-[560px] text-[12px]">
              <thead className="bg-[var(--color-surface-2)]">
                <tr>
                  <th className={TH}>{tr("Serviciu")}</th>
                  <th className={`${TH} text-right`}>{tr("Sold inițial")}</th>
                  <th className={`${TH} text-right`}>{tr("Plătit")}</th>
                  <th className={`${TH} text-right`}>{tr("Recalcul")}</th>
                  <th className={`${TH} text-right`}>{tr("Calculat")}</th>
                  <th className={`${TH} text-right`}>{tr("Spre plată")}</th>
                  <th className={`${TH} text-right`}>{tr("Cotă")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)]">
                {SERVICES.map((s) => {
                  const get = (suffix: string) => COL.get(`${s.k}${suffix}`);
                  const cell = (suffix: string) => { const c = get(suffix); return c ? fmt(c, last[c.key]) : "—"; };
                  const rate = s.rate ? COL.get(s.rate) : undefined;
                  return (
                    <tr key={s.k}>
                      <td className={`${TD} font-medium`}>{tr(s.label)}</td>
                      <td className={`${TD} text-right tabular-nums`}>{cell("SoldInit")}</td>
                      <td className={`${TD} text-right tabular-nums`}>{cell("Platit")}</td>
                      <td className={`${TD} text-right tabular-nums`}>{cell("Recalc")}</td>
                      <td className={`${TD} text-right tabular-nums`}>{cell("Suma")}</td>
                      <td className={`${TD} text-right font-semibold tabular-nums`}>{cell("SprePlata")}</td>
                      <td className={`${TD} text-right tabular-nums`}>{rate ? fmt(rate, last[rate.key]) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {recs.length > 1 && (
            <div className="max-h-[360px] overflow-auto">
              <p className="mb-1 text-[11px] font-semibold text-ink-soft">{tr("Istoric avize 1C")}</p>
              <table className="w-full min-w-[640px] text-[12px]">
                <thead className="sticky top-0 bg-[var(--color-surface-2)]">
                  <tr>
                    <th className={TH}>{tr("Luna")}</th>
                    {["calculat", "soldInit", "platit", "recalc", "deAchitat", "consumTotal"].map((k) => (
                      <th key={k} className={`${TH} text-right`} title={`1C: ${COL.get(k)?.src}`}>{COL.get(k)?.label}</th>
                    ))}
                    <th className={`${TH} text-right`}>{tr("Index vechi → nou")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-line)]">
                  {recs.map((r) => (
                    <tr key={r.id}>
                      <td className={`${TD} font-semibold`}>{String(r.dataDoc ?? "").slice(0, 7) || "—"}</td>
                      {["calculat", "soldInit", "platit", "recalc", "deAchitat", "consumTotal"].map((k) => (
                        <td key={k} className={`${TD} text-right tabular-nums`}>{fmt(COL.get(k)!, r[k])}</td>
                      ))}
                      <td className={`${TD} text-right tabular-nums`}>{r.citirePrec != null || r.citireCurenta != null ? `${r.citirePrec ?? "—"} → ${r.citireCurenta ?? "—"}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      <div className="border-t border-[var(--color-line)]">
        <p className="px-3 pt-3 text-sm font-semibold">{tr("Ce date lipsesc din 1C")}</p>
        <OneCMissingNotice />
      </div>
    </div>
  );
}
