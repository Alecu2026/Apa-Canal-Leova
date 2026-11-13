import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { getMappingOverview } from "@/lib/services/onec-mapping";
import OneCMappingBoard from "@/app/components/OneCMappingBoard";
import { IconChevronLeft } from "@/app/components/icons";
import { getT } from "@/lib/i18n/server-t";

export const dynamic = "force-dynamic";

/** Mapare 1C: variabilele aplicației față în față cu câmpurile din răspunsul 1C, legăturile dintre ele și ce lipsește ca totul să funcționeze. */
export default async function OneCMappingPage() {
  const t = await getT();
  const user = await requireUser();
  if (!can(user, "admin")) redirect("/settings");
  const overview = await getMappingOverview().catch(() => ({ mappings: {}, fields: [], sampled: 0, month: null }));

  return (
    <div className="w-full">
      <Link href="/settings" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink">
        <IconChevronLeft className="size-4" /> {t("Înapoi la setări")}
      </Link>
      <h1 className="mb-1 text-xl font-bold">{t("Mapare 1C")}</h1>
      <p className="mb-4 max-w-3xl text-sm text-ink-soft">
        {t("În stânga: variabilele aplicației. În dreapta: câmpurile trimise de 1C. Liniile arată ce e legat. Variabilele fixe sunt legate în cod; cele marcate „Lipsește” se completează doar dacă le legi de un câmp 1C. Cele de la 1C care nu sunt legate nu sunt folosite deloc.")}
      </p>
      <OneCMappingBoard initial={overview} />
    </div>
  );
}
