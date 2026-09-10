import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type ApiOk } from "@/lib/api";
import { WeeklyTable, type WeeklyRow } from "@/components/WeeklyTable";
import { AiGeneratePanel } from "@/components/AiGeneratePanel";
import { Card } from "@/components/ui/Card";
import { Banner } from "@/components/ui/Banner";
import { Badge } from "@/components/ui/Badge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Button } from "@astryxdesign/core/Button";
import { Text } from "@astryxdesign/core/Text";
import { useEffect, useMemo, useState } from "react";

type Detail = {
  id: number;
  course_name: string;
  course_code: string;
  course_cluster: string | null;
  sks_total: number;
  sks_theory: number;
  sks_practice: number;
  semester: string;
  preparation_date: string;
  lecturers: { name: string; nidn: string; role: string }[];
  weekly_plans: WeeklyRow[];
  status: string;
  file_hash: string | null;
  ai_provider: string | null;
  ai_model: string | null;
};

type AuditRes = { passed: boolean; issues: { code: string; severity: "critical" | "warning"; message: string; field?: string }[] };

export const Route = createFileRoute("/rps/$id")({
  component: RpsDetail,
});

function safeFilename(s: string) {
  return s.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 60) || "RPS";
}

function RpsDetail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // auto-dismiss toast 4s
  useEffect(() => {
    if (!msg && !err) return;
    const t = setTimeout(() => {
      setMsg(null);
      setErr(null);
    }, 4000);
    return () => clearTimeout(t);
  }, [msg, err]);

  const q = useQuery({ queryKey: ["rps", Number(id)], queryFn: () => api<ApiOk<Detail>>(`/api/rps/${id}`) });
  const auditQ = useQuery({
    queryKey: ["rps", Number(id), "audit"],
    queryFn: () => api<ApiOk<AuditRes>>(`/api/rps/${id}/audit`, { method: "POST" }),
    enabled: !!q.data?.data,
  });
  const d = q.data?.data;
  const audit = auditQ.data?.data;
  const hasCritical = audit ? audit.issues.some((i) => i.severity === "critical") : false;

  // local gate from weeklyPlans for instant feedback (before server audit roundtrip)
  const localSum = useMemo(() => {
    const plans = d?.weekly_plans ?? [];
    return plans.filter((p) => !p.is_merged).reduce((s, p) => s + (p.weight ?? 0), 0);
  }, [d?.weekly_plans]);
  const localOk = localSum === 100 || (d?.weekly_plans?.length ?? 0) === 0;

  const saveWeekly = useMutation({
    mutationFn: (weekly_plans: WeeklyRow[]) =>
      api<{ success: boolean; data: { weight_total: number } }>(`/api/rps/${id}`, {
        method: "PUT",
        body: JSON.stringify({ weekly_plans }),
      }),
    onSuccess: () => {
      setMsg("Tersimpan — bobot & 8 kolom sinkron. Jalankan Audit sebelum Generate DOCX.");
      setErr(null);
      qc.invalidateQueries({ queryKey: ["rps", Number(id)] });
      qc.invalidateQueries({ queryKey: ["rps", Number(id), "audit"] });
    },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : String(e)),
  });
  const gen = useMutation({
    mutationFn: () => api<{ success: boolean; data: { docx_url: string; file_hash: string } }>(`/api/rps/${id}/generate`, { method: "POST" }),
    onSuccess: (r) => {
      setMsg(`DOCX siap · ${r.data.file_hash.slice(0, 8)} — klik Download di bawah.`);
      setErr(null);
      qc.invalidateQueries({ queryKey: ["rps", Number(id)] });
    },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : String(e)),
  });
  const auditMut = useMutation({
    mutationFn: () => api<ApiOk<AuditRes>>(`/api/rps/${id}/audit`, { method: "POST" }),
    onSuccess: (r) => {
      const a = r.data;
      if (a.passed) {
        const warn = a.issues.filter((i) => i.severity === "warning");
        setMsg(warn.length ? `Audit passed dengan ${warn.length} warning — cek panel di bawah.` : "Audit passed ✓ — siap Generate DOCX.");
      } else {
        setMsg(`Audit: ${a.issues.map((i) => `[${i.severity}] ${i.message}`).join(" · ")}`);
      }
      setErr(null);
      qc.invalidateQueries({ queryKey: ["rps", Number(id), "audit"] });
    },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : String(e)),
  });

  if (q.isLoading) return <div className="text-sm text-secondary">Memuat…</div>;
  if (!d) return <Banner status="error">Draft tidak ditemukan — kembali ke Drafts.</Banner>;

  const downloadLabel = `${safeFilename(d.course_code)}-${safeFilename(d.course_name)}-RPS.docx`;
  const downloadHref = `/api/rps/${id}/download`;

  return (
    <div className="grid min-w-0 max-w-full gap-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Text weight="semibold">{d.course_name} <span className="font-mono text-xs text-secondary">({d.course_code})</span></Text>
            <Text type="supporting">SKS {d.sks_theory}/{d.sks_practice} total {d.sks_total} · Semester {d.semester} · {new Date(d.preparation_date).toLocaleDateString("id-ID")} · Rumpun {d.course_cluster ?? "—"}</Text>
            <Text type="supporting">Dosen: {d.lecturers.map((l) => `${l.name} (${l.role})`).join(" · ")}</Text>
          </div>
          <Badge variant={d.status === "generated" ? "success" : "default"}>{[d.status, d.file_hash?.slice(0, 8), d.ai_provider ? `${d.ai_provider}/${d.ai_model}` : null].filter(Boolean).join(" · ")}</Badge>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Text type="supporting">Σ non-merge</Text>
          <span className="flex-1"><ProgressBar value={localSum} max={100} /></span>
          <Badge variant={localOk ? "success" : "danger"}>{localOk ? "100 ✓" : `${localSum} — harus 100`}</Badge>
        </div>
      </Card>

      <AiGeneratePanel id={Number(id)} />

      {audit && (
        <Card>
          <div className="flex items-center justify-between">
            <Text weight="semibold">Audit Gate</Text>
            <Badge variant={audit.passed ? "success" : "danger"}>{audit.passed ? "passed ✓" : "blocked — perbaiki critical dulu"}</Badge>
          </div>
          {audit.issues.length === 0 ? (
            <Text type="supporting">Tidak ada issue — siap Generate DOCX.</Text>
          ) : (
            <ul className="mt-2 grid gap-1">
              {audit.issues.map((it, i) => (
                <li key={i}>
                  <Banner status={it.severity === "critical" ? "error" : "warning"} title={`[${it.severity}] ${it.code}`}>
                    {it.message}{it.field ? ` · ${it.field}` : ""}
                  </Banner>
                </li>
              ))}
            </ul>
          )}
          {!audit.passed && <div className="text-xs text-error">Critical memblokir Generate DOCX — perbaiki Σ100 / week 8 &amp; 16 merge dulu.</div>}
        </Card>
      )}

      <WeeklyTable value={d.weekly_plans} onSave={(rows) => saveWeekly.mutate(rows)} />

      {msg && <Banner status="success">{msg}</Banner>}
      {err && <Banner status="error">{err}</Banner>}

      <Card>
        <Text weight="semibold">Generate &amp; Download</Text>
        <Text type="supporting">Alur demo: Audit → Generate DOCX → Download · file disimpan storage/files/{`{id}`}/{`{hash}`}.docx · fallback JS bila Python mati.</Text>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button label={auditMut.isPending ? "Audit…" : auditQ.isFetching ? "Audit (refresh)…" : "Audit"} variant="secondary" isLoading={auditMut.isPending} onClick={() => auditMut.mutate()} />
          <Button label={gen.isPending ? "Generate DOCX…" : "Generate DOCX"} variant="primary" isLoading={gen.isPending} isDisabled={hasCritical} tooltip={hasCritical ? (audit?.issues.filter((i) => i.severity === "critical").map((i) => i.message).join("; ") ?? "Audit critical") : "Generate DOCX via Python (fallback JS)"} onClick={() => gen.mutate()} />
          {d.file_hash ? (
            <Button label="Download DOCX" variant="secondary" href={downloadHref} />
          ) : (
            <Text type="supporting">Belum ada file — Generate dulu</Text>
          )}
        </div>
        {hasCritical && <div className="text-xs text-error">Tombol Generate DOCX dikunci — critical audit harus 0. Perbaiki Σ atau merge UTS/UAS.</div>}
        <Text type="supporting">Filename download: {downloadLabel} · hash {d.file_hash?.slice(0, 12) ?? "—"}</Text>
      </Card>
    </div>
  );
}
