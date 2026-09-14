import { useCallback, useEffect, useRef, useState } from "react";
import { renderAsync } from "docx-preview";
import { Button } from "@astryxdesign/core/Button";
import { Text } from "@astryxdesign/core/Text";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import { Panel } from "./ui/Panel";
import { Banner } from "./ui/Banner";
import type { WeeklyRow } from "./WeeklyTable";

type CpLite = { code: string; description: string };
type DraftLite = {
  course_name: string;
  course_code: string;
  course_cluster: string | null;
  faculty?: string | null;
  study_program?: string | null;
  sks_total: number;
  sks_theory: number;
  sks_practice: number;
  semester: string;
  preparation_date: string;
  lecturers: { name: string; nidn: string; role: string }[];
  description?: string | null;
  bahan_kajian?: string[] | null;
  pustaka_utama?: string[] | null;
  pustaka_pendukung?: string[] | null;
  cpl?: CpLite[] | null;
  cpmk?: CpLite[] | null;
  sub_cpmk?: CpLite[] | null;
};

export function DocxPreview({
  id,
  draft,
  weeklyPlans,
  description,
  bahanKajian,
  pustakaUtama,
  pustakaPendukung,
  cpl,
  cpmk,
  subCpmk,
  downloadLabel,
}: {
  id: number;
  draft: DraftLite;
  weeklyPlans: WeeklyRow[];
  description?: string | null;
  bahanKajian?: string[] | null;
  pustakaUtama?: string[] | null;
  pustakaPendukung?: string[] | null;
  cpl?: CpLite[] | null;
  cpmk?: CpLite[] | null;
  subCpmk?: CpLite[] | null;
  downloadLabel: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const styleRef = useRef<HTMLStyleElement | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [blob, setBlob] = useState<Blob | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const doRender = useCallback(async (signal: AbortSignal) => {
    if (!containerRef.current) return;
    setStatus("loading");
    setError(null);
    containerRef.current.innerHTML = "";
    if (styleRef.current) styleRef.current.textContent = "";
    try {
      const res = await fetch(`/api/rps/${id}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weekly_plans: weeklyPlans,
          description: description ?? draft.description ?? null,
          bahan_kajian: bahanKajian ?? draft.bahan_kajian ?? null,
          pustaka_utama: pustakaUtama ?? draft.pustaka_utama ?? null,
          pustaka_pendukung: pustakaPendukung ?? draft.pustaka_pendukung ?? null,
          cpl: cpl ?? draft.cpl ?? null,
          cpmk: cpmk ?? draft.cpmk ?? null,
          sub_cpmk: subCpmk ?? draft.sub_cpmk ?? null,
          faculty: draft.faculty ?? null,
          study_program: draft.study_program ?? null,
        }),
        signal,
      });
      if (!res.ok) throw new Error(`Gagal memuat pratinjau (${res.status})`);
      const b = await res.blob();
      if (signal.aborted) return;
      setBlob(b);
      await renderAsync(b, containerRef.current!, styleRef.current ?? undefined, {
        inWrapper: true,
        breakPages: true,
        renderHeaders: true,
        renderFooters: true,
        renderFootnotes: true,
        renderEndnotes: true,
      } as never);
      if (signal.aborted) return;
      setStatus("ready");
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setStatus("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [id, weeklyPlans, description, bahanKajian, pustakaUtama, pustakaPendukung, cpl, cpmk, subCpmk, draft.faculty, draft.study_program, draft.description, draft.bahan_kajian, draft.pustaka_utama, draft.pustaka_pendukung, draft.cpl, draft.cpmk, draft.sub_cpmk]);

  useEffect(() => {
    if (!styleRef.current) {
      const el = document.createElement("style");
      el.setAttribute("data-docx-preview", "true");
      document.head.appendChild(el);
      styleRef.current = el;
    }
  }, []);

  useEffect(() => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const t = setTimeout(() => doRender(ac.signal), 380);
    return () => { clearTimeout(t); ac.abort(); };
  }, [doRender]);

  const handlePrint = () => {
    if (!containerRef.current || status !== "ready") return;
    const content = containerRef.current.innerHTML;
    const extraStyle = styleRef.current?.textContent ?? "";
    const w = window.open("", "_blank", "width=1024,height=800");
    if (!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"/><title>${downloadLabel}</title><style>${extraStyle}</style><style>@page{margin:0}body{margin:0;background:#525659}.docx-wrapper{background:#525659 !important;padding:16px !important}.docx-wrapper > section.docx{box-shadow:0 0 8px rgba(0,0,0,.25) !important;margin:12px auto !important}@media print{body,.docx-wrapper{background:#fff !important}.docx-wrapper{padding:0 !important}}</style></head><body><div class="docx-wrapper">${content}</div><script>setTimeout(()=>window.print(),400)<\/script></body></html>`);
    w.document.close();
  };

  const handleDownload = () => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = downloadLabel;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <VStack gap={3}>
      <Panel padding={3}>
        <HStack justify="between" align="center" gap={2} wrap="wrap">
          <Text weight="semibold">Pratinjau</Text>
          <HStack align="center" gap={1} wrap="wrap">
            <div className="flex items-center gap-1 rounded-lg border border-border bg-muted px-1 py-1">
              <Button label="−" variant="secondary" size="sm" onClick={() => setZoom((z) => Math.max(0.6, Number((z - 0.1).toFixed(2))))} />
              <span className="min-w-[3rem] text-center font-mono text-xs">{Math.round(zoom * 100)}%</span>
              <Button label="+" variant="secondary" size="sm" onClick={() => setZoom((z) => Math.min(1.6, Number((z + 0.1).toFixed(2))))} />
            </div>
            <Button label="Cetak" variant="secondary" size="sm" isDisabled={status !== "ready"} onClick={handlePrint} />
            <Button label="Unduh" variant="primary" size="sm" isDisabled={status !== "ready" || !blob} onClick={handleDownload} />
          </HStack>
        </HStack>
      </Panel>

      {status === "error" && error && <Banner status="error">{error}</Banner>}
      {status === "ready" && <Text type="supporting">Yang tampil di sini sama persis dengan file yang diunduh.</Text>}

      <div className="overflow-auto rounded-xl border border-border bg-[#525659] p-2 md:p-4">
        <div className="mx-auto origin-top" style={{ transform: `scale(${zoom})`, width: zoom === 1 ? "100%" : `${100 / zoom}%` }}>
          <div ref={containerRef} className="docx-preview-mount min-h-[520px] bg-[#525659]" />
        </div>
        {status === "loading" && <div className="pointer-events-none fixed inset-0 grid place-items-center bg-black/10 text-sm font-medium text-white">Memuat pratinjau…</div>}
      </div>
    </VStack>
  );
}
