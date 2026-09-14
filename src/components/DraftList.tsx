import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Card } from "@astryxdesign/core/Card";
import { Pagination } from "@astryxdesign/core/Pagination";
import { api, type ApiOk } from "@/lib/api";
import { Badge } from "./ui/Badge";
import { Banner } from "./ui/Banner";
import { Empty } from "./ui/Empty";

type Row = {
  id: number; course_name: string; course_code: string; semester: string; status: string; updated_at: string;
  study_program: string | null; owner_name: string | null; owner_nidn: string | null; is_mine: boolean;
};
type Paged = { current_page: number; per_page: number; total: number; last_page: number; from: number; to: number };
type Meta = { signed_in: boolean; role: string | null };

/**
 * Daftar draft RPS pengguna aktif.
 *
 * Setiap kartu = ringkasan MK + status + tombol aksi. Sebelumnya kartu
 * ditulis dengan div+Tailwind manual; sekarang memakai `Card` Astryx dan
 * `HStack`/`VStack` supaya spacing dan aksesibilitas seragam.
 */
export function DraftList() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [debouncedQ, setDebouncedQ] = useState("");

  const onSearch = (v: string) => {
    setQ(v);
    setPage(1);
    // Debounce ringan: menghindari request per-ketikan tapi respon terasa cepat.
    setTimeout(() => setDebouncedQ(v.trim()), 300);
    if (!v.trim()) setDebouncedQ("");
  };

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["rps", debouncedQ, page],
    queryFn: () =>
      api<ApiOk<Row[]>>(`/api/rps?q=${encodeURIComponent(debouncedQ)}&page=${page}&per_page=10`),
  });

  const rows = data?.data ?? [];
  const pagination = (data as unknown as { pagination?: Paged })?.pagination;
  const meta = (data as unknown as { meta?: Meta })?.meta;
  const signedIn = meta?.signed_in ?? false;
  const del = useMutation({
    mutationFn: (id: number) => api<{ success: boolean }>(`/api/rps/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rps"] }),
  });
  const [confirmId, setConfirmId] = useState<number | null>(null);

  if (isLoading) return <Text type="supporting">Memuat…</Text>;

  return (
    <VStack gap={3}>
      <HStack justify="between" align="center" gap={2}>
        <Text weight="semibold">Draft RPS — klik untuk lanjut edit</Text>
        <HStack align="center" gap={2}>
          <TextInput
            label="Cari"
            isLabelHidden
            type="text"
            value={q}
            onChange={onSearch}
            placeholder="Cari nama / kode (mis. IW21ASK1541)"
          />
          {isFetching && <Text type="supporting">…</Text>}
        </HStack>
      </HStack>

      {!signedIn ? (
        <Empty
          title="Masuk untuk melihat dan menulis RPS"
          description="Menulis RPS memerlukan akun dosen yang dibuat pengelola. Dokumen yang sudah terbit tetap bisa diunduh lewat tautannya tanpa login."
          actions={<Link to="/admin/login"><Button label="Masuk sebagai dosen / pengelola" variant="primary" size="sm" /></Link>}
        />
      ) : rows.length === 0 ? (
        <Empty
          title="Belum ada draft"
          description="Buat draft pertama lewat tombol 'Buat RPS baru' di atas, atau isi otomatis dari bank kurikulum prodi setelah draft dibuka. Tip: atur API Key di Settings bila ingin memakai Generate AI (BYOK)."
        />
      ) : (
        <VStack gap={3}>
          {rows.map((r) => (
            <Card key={r.id} padding={4}>
              <HStack justify="between" align="center" gap={3}>
                <Link
                  to="/rps/$id"
                  params={{ id: String(r.id) }}
                  className="min-w-0 flex-1 no-underline"
                >
                  <VStack gap={1}>
                    <Text weight="semibold">
                      {r.course_name}{" "}
                      <span className="font-mono text-xs text-secondary">({r.course_code})</span>
                    </Text>
                    <Text type="supporting">
                      Semester {r.semester} · {new Date(r.updated_at).toLocaleDateString("id-ID")} · ID {r.id}
                      {r.study_program ? ` · ${r.study_program}` : ""}
                    </Text>
                    <Text type="supporting">
                      {r.is_mine
                        ? "Milik Anda"
                        : r.owner_name
                          ? `Penulis: ${r.owner_name}`
                          : "Belum ada pemilik"}
                    </Text>
                  </VStack>
                </Link>
                <HStack align="center" gap={2}>
                  <Badge variant={r.status === "generated" ? "success" : "default"}>{r.status}</Badge>
                  {r.status === "generated" && (
                    <Button label="Download" variant="secondary" size="sm" href={`/api/rps/${r.id}/download`} />
                  )}
                  {confirmId === r.id ? (
                    <HStack align="center" gap={1}>
                      <Button
                        label="Ya, hapus"
                        variant="destructive"
                        size="sm"
                        isLoading={del.isPending}
                        onClick={() => { del.mutate(r.id); setConfirmId(null); }}
                      />
                      <Button
                        label="Batal"
                        variant="secondary"
                        size="sm"
                        onClick={() => setConfirmId(null)}
                      />
                    </HStack>
                  ) : (
                    <Button label="Hapus" variant="ghost" size="sm" onClick={() => setConfirmId(r.id)} />
                  )}
                </HStack>
              </HStack>
            </Card>
          ))}
        </VStack>
      )}

      {pagination && pagination.last_page > 1 && (
        <HStack justify="between" align="center">
          <Text type="supporting">
            {pagination.from}–{pagination.to} dari {pagination.total}
          </Text>
          <Pagination
            page={pagination.current_page}
            totalPages={pagination.last_page}
            onChange={setPage}
          />
        </HStack>
      )}

      {del.isError && (
        <Banner status="error">{del.error instanceof Error ? del.error.message : String(del.error)}</Banner>
      )}
    </VStack>
  );
}
