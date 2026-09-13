import { useQuery } from "@tanstack/react-query";
import { Text } from "@astryxdesign/core/Text";
import { AUDIT_ACTION_LABEL, fetchAudit, type AuditEntry } from "@/lib/admin";
import { Badge } from "./ui/Badge";
import { Banner } from "./ui/Banner";
import { Card } from "./ui/Card";

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("id-ID", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

/** Ringkas nilai apa pun jadi satu baris yang bisa dibaca. */
function summarise(value: unknown): string {
  if (value === null || value === undefined || value === "") return "(kosong)";
  if (Array.isArray(value)) return `${value.length} entri`;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 90 ? `${text.slice(0, 90)}…` : text;
}

/**
 * Riwayat perubahan master data.
 *
 * Daftar ini dibatasi server sesuai wewenang pembaca, jadi admin fakultas tidak
 * melihat aktivitas fakultas lain.
 */
export function AuditLogPanel({ enabled }: { enabled: boolean }) {
  const audit = useQuery({
    queryKey: ["admin-audit"],
    queryFn: () => fetchAudit(50),
    enabled,
    throwOnError: false,
  });

  const rows = audit.data?.data ?? [];

  return (
    <Card>
      <Text weight="semibold">Riwayat perubahan</Text>
      <Text type="supporting">
        Catatan siapa mengubah apa dan kapan — dipakai saat audit mutu dan akreditasi.
        Password tidak pernah dicatat di sini.
      </Text>

      {audit.isLoading && <div className="mt-3"><Text type="supporting">Memuat riwayat…</Text></div>}
      {audit.isError && <div className="mt-3"><Banner status="error">Gagal memuat riwayat.</Banner></div>}

      {!audit.isLoading && rows.length === 0 && (
        <div className="mt-3">
          <Text type="supporting">Belum ada perubahan yang tercatat.</Text>
        </div>
      )}

      <div className="mt-3 grid gap-2">
        {rows.map((entry) => <AuditRow key={entry.id} entry={entry} />)}
      </div>
    </Card>
  );
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const fields = Object.entries(entry.changes);
  return (
    <div className="grid gap-1 rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Text weight="semibold">
          {AUDIT_ACTION_LABEL[entry.action] ?? entry.action}
          {entry.entity_label ? ` — ${entry.entity_label}` : ""}
        </Text>
        <Badge variant="default">{formatWhen(entry.created_at)}</Badge>
      </div>
      <Text type="supporting">
        oleh {entry.actor_name} (NIDN {entry.actor_nidn}) · {entry.entity_ref}
      </Text>
      {fields.length > 0 && (
        <ul className="mt-1 grid gap-1">
          {fields.map(([field, change]) => (
            <li key={field} className="text-xs leading-relaxed text-secondary">
              <span className="font-mono">{field}</span>: {summarise(change.before)} → {summarise(change.after)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
