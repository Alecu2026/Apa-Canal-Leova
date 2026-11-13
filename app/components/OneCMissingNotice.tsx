import { getT } from "@/lib/i18n/server-t";

/**
 * „Ce date NU vin din noul 1C” — lista clară a ce lipsește și ce efect are în aplicație (coloane / filtre goale). Folosită pe lista Plătitori (restrânsă)
 * și pe fișa plătitorului. Conținutul reflectă exact formatul avizelor 1C (…/infoCec/info/apl): vezi lib/apa-canal-1c.ts.
 */
export default async function OneCMissingNotice({ collapsible = false }: { collapsible?: boolean }) {
  const tr = await getT();
  const items: [string, string][] = [
    [tr("Telefon și email"), tr("Notificările SMS, apel și email nu au destinatar. Se introduc manual sau din Excel, după codul abonatului.")],
    [tr("Tip sector (privat / comunal) și sectorul 1C"), tr("Coloana și filtrele pe sector rămân goale.")],
    [tr("Persoană fizică sau firmă, nr. contract, IDNO"), tr("Toți abonații apar ca persoane fizice; firmele nu se pot deosebi.")],
    [tr("Data instalării contorului"), tr("Coloana, filtrul „instalat după” și sortarea după instalare rămân goale.")],
    [tr("Sursa citirii (citit sau calculat) și data citirii"), tr("Nu se știe dacă volumul e estimat; filtrul „citire estimată” nu funcționează.")],
    [tr("Mai multe contoare pe același abonat"), tr("Avizul are un singur număr de contor; un abonat cu mai multe contoare apare cu unul.")],
    [tr("Numele consumatorilor, nr. de persoane, suprafața, începutul consumului"), tr("Filtrul „loc de consum nou” rămâne gol.")],
    [tr("Localitatea ca câmp separat"), tr("Apare doar în textul străzii (uneori lipsește), deci filtrul pe localitate poate grupa greșit.")],
    [tr("Data plății"), tr("Se vede doar suma plătită în lună, nu ziua plății.")],
    [tr("Abonații cu sold zero sau avans (și suma avansului)"), tr("1C nu-i trimite în luna respectivă. Aplicația îi arată cu sold 0 și factura precedentă achitată, dar nu știe cât avans au.")],
  ];
  const body = (
    <>
      <p className="text-xs text-ink-soft">{tr("Aceste date nu sunt trimise de noul serviciu 1C (avize de plată). Rămân goale pentru abonații din 1C, cu efectele de mai jos.")}</p>
      <ul className="mt-2 flex flex-col gap-1.5 text-[13px]">
        {items.map(([what, effect]) => (
          <li key={what} className="rounded-lg bg-[var(--color-surface-2)] px-2.5 py-1.5">
            <b>{what}</b>
            <span className="text-ink-soft"> — {effect}</span>
          </li>
        ))}
      </ul>
    </>
  );
  if (!collapsible) return <div className="p-3">{body}</div>;
  return (
    <details className="card mb-3 p-3">
      <summary className="cursor-pointer text-sm font-semibold">
        {tr("Ce date lipsesc din noul 1C")} <span className="font-normal text-ink-soft">({items.length})</span>
      </summary>
      <div className="mt-2">{body}</div>
    </details>
  );
}
