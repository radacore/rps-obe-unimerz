import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api, type ApiOk } from "@/lib/api";
import { Card } from "./ui/Card";
import { Badge } from "./ui/Badge";
import { Banner } from "./ui/Banner";
import { Button } from "@astryxdesign/core/Button";

type Row = { id: number; course_name: string; course_code: string; semester: string; status: string; updated_at: string };
type Paged = { current_page: number; per_page: number; total: number; last_page: number; from: number; to: number };

export function DraftList() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [debouncedQ, setDebouncedQ] = useState("");

  // debounce search 300ms
  const onSearch = (v: string) => {
    setQ(v);
    setPage(1);
    setTimeout(() => setDebouncedQ(v.trim()), 300);
    // immediate if cleared
    if (!v.trim()) setDebouncedQ("");
  };

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["rps", debouncedQ, page],
    queryFn: () =>
      api<ApiOk<Row[]>>(`/api/rps?q=${encodeURIComponent(debouncedQ)}&page=${page}&per_page=10`),
  });

  const rows = data?.data ?? [];
  const pagination = (data as unknown as { pagination?: Paged })?.pagination;
  const del = useMutation({
    mutationFn: (id: number) => api<{ success: boolean }>(`/api/rps/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rps"] }),
  });
  const [confirmId, setConfirmId] = useState<number | null>(null);

  if (isLoading) return <div className="text-sm text-secondary">Memuat…</div>;

  return (
    <div className="grid gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-sm font-medium">Draft RPS — klik untuk lanjut edit</span>
        <div className="flex items-center gap-2">
          <input
            placeholder="Cari nama / kode (mis. IW21ASK1541)"
            className="w-[260px] rounded-full border bg-surface px-3 py-1.5 text-sm placeholder:text-secondary focus:outline-none focus:ring-1 focus:ring-accent"
            value={q}
            onChange={(e) => onSearch(e.target.value)}
          />
          {isFetching && <span className="text-xs text-secondary">…</span>}
        </div>
      </div>

      {rows.length === 0 ? (
        <Card>
          <div className="py-8 text-center">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-accent-muted text-accent">＋</div>
            <div className="mt-3 text-sm font-medium">Belum ada draft</div>
            <div className="mt-1 text-xs leading-relaxed text-secondary">
              Buat draft pertama di form di bawah — contoh siap pakai <span className="font-mono">IW21ASK1541 Ilmu Biomedik Dasar (3SKS Teori + 1 Praktik)</span>.
              <br />
              Alur demo dosen (2 menit): <span className="font-medium">Buat Draft → Detail → Generate AI 9 baris → Simpan → Audit → Generate DOCX → Download</span>.
            </div>
            <div className="mt-3 text-xs text-secondary">Tip: atur API Key di Settings dulu bila ingin Generate AI (BYOK OpenAI/Gemini).</div>
          </div>
        </Card>
      ) : (
        <div className="grid gap-3">
          {rows.map((r) => (
            <Card key={r.id}>
              <div className="flex items-center justify-between gap-3">
                <Link to="/rps/$id" params={{ id: String(r.id) }} className="min-w-0 flex-1 no-underline">
                  <div className="truncate font-medium">{r.course_name} <span className="font-mono text-xs text-secondary">({r.course_code})</span></div>
                  <div className="text-xs text-secondary">Semester {r.semester} · {new Date(r.updated_at).toLocaleDateString("id-ID")} · ID {r.id}</div>
                </Link>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant={r.status === "generated" ? "success" : "default"}>{r.status}</Badge>
                  {r.status === "generated" && <Button label="Download" variant="secondary" size="sm" href={`/api/rps/${r.id}/download`} />}
                  {confirmId === r.id ? (
                    <span className="flex items-center gap-1">
                      <Button label="Ya, hapus" variant="destructive" size="sm" isLoading={del.isPending} onClick={() => { del.mutate(r.id); setConfirmId(null); }} />
                      <Button label="Batal" variant="secondary" size="sm" onClick={() => setConfirmId(null)} />
                    </span>
                  ) : (
                    <Button label="Hapus" variant="ghost" size="sm" onClick={() => setConfirmId(r.id)} />
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {pagination && pagination.last_page > 1 && (
        <div className="flex items-center justify-between rounded-xl border bg-surface px-3 py-2 text-xs text-secondary">
          <span>{pagination.from}–{pagination.to} dari {pagination.total}</span>
          <span className="flex items-center gap-1">
            <Button label="← Prev" variant="secondary" size="sm" isDisabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} />
            <span className="px-2 py-1 font-mono">{pagination.current_page} / {pagination.last_page}</span>
            <Button label="Next →" variant="secondary" size="sm" isDisabled={page >= pagination.last_page} onClick={() => setPage((p) => p + 1)} />
          </span>
        </div>
      )}

      {del.isError && (
        <Banner status="error">{del.error instanceof Error ? del.error.message : String(del.error)}</Banner>
      )}
    </div>
  );
}
