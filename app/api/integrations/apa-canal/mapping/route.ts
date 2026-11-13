import { getCurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { logAudit } from "@/lib/services/audit";
import { getMappingOverview, saveMapping } from "@/lib/services/onec-mapping";
import { APP_FIELDS } from "@/lib/onec-map";

export const dynamic = "force-dynamic";

/** Legăturile variabile aplicație ↔ câmpuri 1C și câmpurile venite de la 1C (cu exemple). Doar administratorii. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!can(user, "admin")) return Response.json({ error: "Doar un administrator poate vedea maparea 1C." }, { status: 403 });
  return Response.json(await getMappingOverview());
}

/** Leagă / dezleagă o variabilă: `{ appField, source }` (source null sau gol = dezleagă). */
export async function PUT(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!can(user, "admin")) return Response.json({ error: "Doar un administrator poate schimba maparea 1C." }, { status: 403 });

  let body: { appField?: unknown; source?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Cerere invalidă." }, { status: 400 });
  }
  if (typeof body.appField !== "string") return Response.json({ error: "Lipsește variabila." }, { status: 400 });
  const source = typeof body.source === "string" ? body.source : null;
  const res = await saveMapping(body.appField, source, user.id);
  if (!res.ok) return Response.json({ error: res.error }, { status: 400 });

  const label = APP_FIELDS.find((f) => f.key === body.appField)?.label ?? body.appField;
  await logAudit(
    { id: user.id, name: user.name, role: user.role, isSuperAdmin: user.isSuperAdmin },
    { action: "integration.update", module: "Integrations", objectName: "Mapare 1C", newValue: source?.trim() ? `${label} ← ${source.trim()}` : `${label}: dezlegat` },
  );
  return Response.json(await getMappingOverview());
}
