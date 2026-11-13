"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { APP_FIELDS, GROUP_LABEL, featureStatus, fieldStatus, type AppField, type AppFieldGroup } from "@/lib/onec-map";
import type { MappingOverview, OneCFieldInfo } from "@/lib/services/onec-mapping";
import { IconCheckCircle, IconX, IconXCircle } from "./icons";
import { useT } from "@/lib/i18n/context";

type Filter = "all" | "missing" | "connected" | "local";
type Line = { id: string; d: string; user: boolean; appKey: string; c1: string };

const GROUPS: AppFieldGroup[] = ["client", "invoice", "meter", "local"];

/**
 * Pagina „Mapare 1C”: variabilele aplicației (stânga) și câmpurile din răspunsul 1C (dreapta), cu linii între cele legate.
 * Variabilele „legabile” se leagă din pagină (apasă „Leagă”, apoi alege câmpul 1C sau scrie numele lui); cele fixe sunt legate în cod, cele locale n-au sursă în 1C.
 * Sus: ce funcții merg complet și ce lipsește pentru celelalte.
 */
export default function OneCMappingBoard({ initial }: { initial: MappingOverview }) {
  const t = useT();
  const [data, setData] = useState(initial);
  const [filter, setFilter] = useState<Filter>("all");
  const [onlyUnused, setOnlyUnused] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const [hover, setHover] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);

  const boardRef = useRef<HTMLDivElement>(null);
  const appEls = useRef(new Map<string, HTMLElement>());
  const c1Els = useRef(new Map<string, HTMLElement>());

  const { mappings } = data;

  // câmpurile 1C: cele din răspuns + (dacă ai legat un nume care încă nu vine de la 1C) câmpul „așteptat”
  const fields = useMemo<OneCFieldInfo[]>(() => {
    const have = new Set(data.fields.map((f) => f.key));
    const extra = Object.values(mappings).filter((k) => !have.has(k));
    return [
      ...data.fields,
      ...[...new Set(extra)].map((key) => ({ key, label: "Câmp așteptat de la 1C (încă nu apare în răspuns)", group: "Câmpuri așteptate", known: false, sample: null, fill: null })),
    ];
  }, [data.fields, mappings]);

  const status = useMemo(() => new Map(APP_FIELDS.map((f) => [f.key, fieldStatus(f, mappings)])), [mappings]);
  const usedBy = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const f of APP_FIELDS) for (const s of status.get(f.key)?.sources ?? []) m.set(s, [...(m.get(s) ?? []), f.key]);
    return m;
  }, [status]);
  const labelOf = useMemo(() => new Map(APP_FIELDS.map((f) => [f.key, f.label])), []);

  const features = useMemo(() => featureStatus(mappings), [mappings]);
  const counts = useMemo(() => {
    const rel = APP_FIELDS.filter((f) => f.kind !== "local");
    const connected = rel.filter((f) => status.get(f.key)?.status === "connected").length;
    return {
      connected,
      missing: rel.length - connected,
      unused: fields.filter((f) => !usedBy.has(f.key)).length,
      ok: features.filter((f) => f.ok).length,
    };
  }, [status, fields, usedBy, features]);

  const appRows = useMemo(
    () => APP_FIELDS.filter((f) => (filter === "all" ? true : (status.get(f.key)?.status ?? "local") === filter)),
    [filter, status],
  );
  const c1Rows = useMemo(() => fields.filter((f) => !onlyUnused || !usedBy.has(f.key)), [fields, onlyUnused, usedBy]);

  async function save(appField: string, source: string | null) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/integrations/apa-canal/mapping", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appField, source }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? t("Nu s-a putut salva."));
      setData(j);
      setPicking(null);
      setCustom("");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Nu s-a putut salva."));
    } finally {
      setBusy(false);
    }
  }

  // liniile dintre rândurile legate (doar pe ecran lat, unde coloanele stau una lângă alta)
  const measure = useCallback(() => {
    const box = boardRef.current;
    if (!box || typeof window === "undefined" || !window.matchMedia("(min-width: 1024px)").matches) { setLines([]); return; }
    const c = box.getBoundingClientRect();
    const next: Line[] = [];
    for (const f of appRows) {
      const a = appEls.current.get(f.key);
      if (!a) continue;
      const ar = a.getBoundingClientRect();
      for (const src of status.get(f.key)?.sources ?? []) {
        const b = c1Els.current.get(src);
        if (!b) continue;
        const br = b.getBoundingClientRect();
        const x1 = ar.right - c.left, y1 = ar.top + ar.height / 2 - c.top;
        const x2 = br.left - c.left, y2 = br.top + br.height / 2 - c.top;
        const mx = (x1 + x2) / 2;
        next.push({ id: `${f.key}>${src}`, d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`, user: f.kind === "mappable", appKey: f.key, c1: src });
      }
    }
    setLines(next);
  }, [appRows, status]);

  useLayoutEffect(() => {
    measure();
  }, [measure, c1Rows, picking]);
  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  const hot = (l: Line) => hover === `a:${l.appKey}` || hover === `c:${l.c1}` || picking === l.appKey;
  const anyHot = hover !== null || picking !== null;

  const chip = (kind: "fixed" | "user" | "missing" | "local") => {
    const cls = {
      fixed: "bg-[var(--color-surface-2)] text-ink-soft",
      user: "bg-brand-soft text-brand-strong",
      missing: "bg-st-cancelled/15 text-st-cancelled",
      local: "bg-[var(--color-surface-2)] text-ink-soft",
    }[kind];
    const label = { fixed: t("Legat în cod"), user: t("Legat de tine"), missing: t("Lipsește"), local: t("Doar local") }[kind];
    return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>{label}</span>;
  };

  const FILTERS: [Filter, string][] = [["all", t("Toate")], ["missing", t("Lipsesc")], ["connected", t("Legate")], ["local", t("Doar locale")]];
  const byGroup = (g: AppFieldGroup) => appRows.filter((f) => f.group === g);
  const c1Groups = useMemo(() => {
    const out: [string, OneCFieldInfo[]][] = [];
    for (const f of c1Rows) {
      const g = out.find((x) => x[0] === f.group);
      if (g) g[1].push(f);
      else out.push([f.group, [f]]);
    }
    return out;
  }, [c1Rows]);

  return (
    <div className="flex flex-col gap-4">
      {/* Rezumat */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="card p-3 text-center"><p className="text-2xl font-bold tabular-nums text-st-done">{counts.connected}</p><p className="text-xs text-ink-soft">{t("variabile legate")}</p></div>
        <div className="card p-3 text-center"><p className={`text-2xl font-bold tabular-nums ${counts.missing ? "text-st-cancelled" : ""}`}>{counts.missing}</p><p className="text-xs text-ink-soft">{t("variabile care lipsesc")}</p></div>
        <div className="card p-3 text-center"><p className="text-2xl font-bold tabular-nums">{counts.unused}</p><p className="text-xs text-ink-soft">{t("câmpuri 1C nefolosite")}</p></div>
        <div className="card p-3 text-center"><p className="text-2xl font-bold tabular-nums">{counts.ok}/{features.length}</p><p className="text-xs text-ink-soft">{t("funcții complete")}</p></div>
      </div>

      {/* Funcțiile: merg complet sau lipsesc variabile */}
      <div className="card p-3">
        <h2 className="mb-2 text-sm font-bold">{t("Ce funcționează și ce nu")}</h2>
        <ul className="grid gap-1.5 md:grid-cols-2">
          {features.map(({ feature, ok, missing }) => (
            <li key={feature.key} className={`flex items-start gap-2 rounded-lg px-2.5 py-1.5 text-[13px] ${ok ? "bg-st-done/10" : "bg-st-cancelled/10"}`}>
              {ok ? <IconCheckCircle className="mt-0.5 size-4 shrink-0 text-st-done" /> : <IconXCircle className="mt-0.5 size-4 shrink-0 text-st-cancelled" />}
              <span className="min-w-0">
                <b>{t(feature.label)}</b>
                <span className="text-ink-soft"> — {ok ? t("complet") : `${t("lipsește")}: ${missing.map((m) => t(m.label)).join(", ")}`}</span>
                {!ok && <span className="block text-[11px] text-ink-soft">{t(feature.why)}</span>}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Filtre */}
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setFilter(k)} className={`tap h-8 rounded-full px-3 text-xs font-semibold ${filter === k ? "bg-brand text-white" : "border border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)]"}`}>
            {label}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-1.5 text-xs text-ink-soft">
          <input type="checkbox" checked={onlyUnused} onChange={(e) => setOnlyUnused(e.target.checked)} /> {t("doar câmpurile 1C nefolosite")}
        </label>
      </div>

      {error && <p role="alert" className="rounded-lg bg-st-cancelled/10 px-3 py-2 text-sm text-st-cancelled">{error}</p>}
      {picking && (
        <div className="card flex flex-wrap items-center gap-2 border-brand p-3 text-sm">
          <span className="min-w-0">{t("Alege din dreapta câmpul 1C pentru")} <b>{labelOf.get(picking)}</b>, {t("sau scrie numele lui (dacă 1C îl va adăuga):")}</span>
          <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="ex. Telefon" maxLength={80} className="h-9 w-44 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 text-sm outline-none focus:border-brand" />
          <button type="button" disabled={busy || !custom.trim()} onClick={() => save(picking, custom.trim())} className="tap h-9 rounded-lg bg-brand px-3 text-xs font-semibold text-white disabled:opacity-50">{t("Leagă")}</button>
          <button type="button" onClick={() => { setPicking(null); setCustom(""); }} className="tap h-9 rounded-lg border border-[var(--color-line)] px-3 text-xs">{t("Renunță")}</button>
        </div>
      )}

      {/* Tabla: stânga aplicația, dreapta 1C, liniile între ele */}
      <div ref={boardRef} className="relative grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_72px_minmax(0,1fr)]">
        <svg className="pointer-events-none absolute inset-0 hidden h-full w-full overflow-visible lg:block" aria-hidden>
          {lines.map((l) => {
            const h = hot(l);
            return (
              <path
                key={l.id}
                d={l.d}
                fill="none"
                stroke={l.user ? "var(--color-brand)" : "var(--color-ink-soft)"}
                strokeWidth={h ? 2.5 : l.user ? 2 : 1}
                opacity={anyHot ? (h ? 1 : 0.08) : l.user ? 0.9 : 0.3}
              />
            );
          })}
        </svg>

        <section>
          <h2 className="mb-2 text-sm font-bold">{t("Variabilele aplicației")}</h2>
          <div className="flex flex-col gap-3">
            {GROUPS.map((g) => {
              const rows = byGroup(g);
              if (!rows.length) return null;
              return (
                <div key={g} className="card overflow-hidden">
                  <p className="bg-[var(--color-surface-2)] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-soft">{t(GROUP_LABEL[g])}</p>
                  <ul className="divide-y divide-[var(--color-line)]">
                    {rows.map((f) => renderAppRow(f))}
                  </ul>
                </div>
              );
            })}
            {appRows.length === 0 && <p className="card p-4 text-center text-sm text-ink-soft">{t("Nicio variabilă în această categorie.")}</p>}
          </div>
        </section>

        <div className="hidden lg:block" />

        <section>
          <h2 className="mb-1 text-sm font-bold">{t("Câmpurile trimise de 1C")}</h2>
          <p className="mb-2 text-[11px] text-ink-soft">
            {data.sampled > 0
              ? t("Exemple și completare din {n} avize ({month}).", { n: data.sampled, month: data.month ?? "" })
              : t("Încă nu s-a făcut nicio sincronizare: se arată câmpurile cunoscute, fără exemple.")}
          </p>
          <div className="flex flex-col gap-3">
            {c1Groups.map(([g, rows]) => (
              <div key={g} className="card overflow-hidden">
                <p className="bg-[var(--color-surface-2)] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-soft">{t(g)}</p>
                <ul className="divide-y divide-[var(--color-line)]">
                  {rows.map((f) => {
                    const used = usedBy.get(f.key);
                    const pickable = !!picking && APP_FIELDS.find((a) => a.key === picking)?.kind === "mappable";
                    return (
                      <li
                        key={f.key}
                        ref={(el) => { if (el) c1Els.current.set(f.key, el); else c1Els.current.delete(f.key); }}
                        onMouseEnter={() => setHover(`c:${f.key}`)}
                        onMouseLeave={() => setHover(null)}
                        onClick={() => pickable && !busy && save(picking!, f.key)}
                        className={`flex items-center justify-between gap-2 px-3 py-1.5 text-[13px] ${pickable ? "cursor-pointer hover:bg-brand-soft" : ""}`}
                      >
                        <span className="min-w-0">
                          <b className="font-mono text-[12px]">{f.key}</b>
                          {!f.known && <span className="ml-1 rounded-full bg-st-progress/15 px-1.5 py-px text-[10px] font-semibold text-st-progress">{t("nou")}</span>}
                          <span className="block truncate text-[11px] text-ink-soft">
                            {t(f.label)}
                            {f.sample != null && <> · {t("ex.")} <span className="font-medium text-ink">{f.sample}</span></>}
                            {f.fill != null && <> · {Math.round(f.fill * 100)}%</>}
                          </span>
                        </span>
                        <span className="shrink-0 text-right text-[10px]">
                          {used ? <span className="text-st-done">→ {used.map((k) => t(labelOf.get(k) ?? k)).join(", ")}</span> : <span className="text-ink-soft">{t("nefolosit")}</span>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );

  /** Un rând al variabilelor aplicației (funcție de randare, nu componentă: să nu se remonteze la fiecare hover). */
  function renderAppRow(f: AppField) {
    const st = status.get(f.key)!;
    const kind = st.status === "local" ? "local" : st.status === "missing" ? "missing" : f.kind === "mappable" ? "user" : "fixed";
    const active = picking === f.key;
    return (
      <li
        key={f.key}
        ref={(el) => { if (el) appEls.current.set(f.key, el); else appEls.current.delete(f.key); }}
        onMouseEnter={() => setHover(`a:${f.key}`)}
        onMouseLeave={() => setHover(null)}
        className={`flex items-start justify-between gap-2 px-3 py-1.5 text-[13px] ${active ? "bg-brand-soft" : ""}`}
      >
        <span className="min-w-0">
          <b>{t(f.label)}</b>
          <span className="block truncate font-mono text-[10px] text-ink-soft">{f.where}</span>
          {st.sources.length > 0 && <span className="block text-[11px] text-ink-soft">← {st.sources.join(" + ")}{f.note ? ` · ${t(f.note)}` : ""}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {chip(kind)}
          {f.kind === "mappable" && (
            <>
              <button type="button" onClick={() => { setPicking(active ? null : f.key); setCustom(""); }} className="tap h-7 rounded-lg border border-[var(--color-line)] px-2 text-[11px] font-semibold hover:bg-[var(--color-surface-2)]">
                {active ? t("Renunță") : st.status === "connected" ? t("Schimbă") : t("Leagă")}
              </button>
              {st.status === "connected" && (
                <button type="button" aria-label={t("Dezleagă")} title={t("Dezleagă")} disabled={busy} onClick={() => save(f.key, null)} className="tap grid size-7 place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)]">
                  <IconX className="size-3.5" />
                </button>
              )}
            </>
          )}
        </span>
      </li>
    );
  }
}
