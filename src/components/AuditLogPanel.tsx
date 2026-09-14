import { useQuery } from "@tanstack/react-query";
import { Text } from "@astryxdesign/core/Text";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import { List, ListItem } from "@astryxdesign/core/List";
import { AUDIT_ACTION_LABEL, fetchAudit, type AuditEntry } from "@/lib/admin";
import { Badge } from "./ui/Badge";
import { Banner } from "./ui/Banner";
import { Panel } from "./ui/Panel";

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
    <Panel
      title="Riwayat perubahan"
      description="Catatan siapa mengubah apa dan kapan — dipakai saat audit mutu dan akreditasi. Password tidak pernah dicatat di sini."
    >
      <VStack gap={2}>
        {audit.isLoading && <Text type="supporting">Memuat riwayat…</Text>}
        {audit.isError && <Banner status="error">Gagal memuat riwayat.</Banner>}
        {!audit.isLoading && rows.length === 0 && (
          <Text type="supporting">Belum ada perubahan yang tercatat.</Text>
        )}
        {rows.map((entry) => <AuditRow key={entry.id} entry={entry} />)}
      </VStack>
    </Panel>
  );
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const fields = Object.entries(entry.changes);
  return (
    <Panel padding={3}>
      <VStack gap={1}>
        <HStack justify="between" align="center" gap={2} wrap="wrap">
          <Text weight="semibold">
            {AUDIT_ACTION_LABEL[entry.action] ?? entry.action}
            {entry.entity_label ? ` — ${entry.entity_label}` : ""}
          </Text>
          <Badge variant="default">{formatWhen(entry.created_at)}</Badge>
        </HStack>
        <Text type="supporting">
          {`oleh ${entry.actor_name} (NIDN ${entry.actor_nidn}) · ${entry.entity_ref}`}
        </Text>
        {fields.length > 0 && (
          <List density="compact">
            {fields.map(([field, change]) => (
              <ListItem
                key={field}
                label={`${field}: ${summarise(change.before)} → ${summarise(change.after)}`}
              />
            ))}
          </List>
        )}
      </VStack>
    </Panel>
  );
}
