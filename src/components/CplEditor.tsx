import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { ApiError } from "@/lib/api";
import {
  CPL_CATEGORY_OPTIONS, updateProgramCpl,
  type CplCategory, type CplItem,
} from "@/lib/admin";
import { Badge } from "./ui/Badge";
import { Banner } from "./ui/Banner";
import { Card } from "./ui/Card";

function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const first = Object.values(e.fieldErrors)[0]?.[0];
    if (first) return first;
  }
  return e instanceof Error ? e.message : String(e);
}

/**
 * Editor CPL program studi.
 *
 * Kategori SN-Dikti (sikap / pengetahuan / keterampilan umum / khusus) boleh
 * kosong: 37 prodi hasil scraping belum punya klasifikasi ini, dan memaksanya
 * akan menolak seluruh data yang sudah ada.
 */
export function CplEditor({
  slug, label, initialCpl,
}: { slug: string; label: string; initialCpl: CplItem[] }) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<CplItem[]>(initialCpl);
  const [baseline, setBaseline] = useState<CplItem[]>(initialCpl);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!msg && !error) return;
    const t = setTimeout(() => { setMsg(null); setError(null); }, 4000);
    return () => clearTimeout(t);
  }, [msg, error]);

  const dirty = JSON.stringify(rows) !== JSON.stringify(baseline);

  // Aturan ini mencerminkan `studyProgramCplSchema` di server. Tujuannya
  // memberi tahu lebih awal, bukan menggantikan validasi server.
  const codes = rows.map((r) => r.code.trim().toUpperCase()).filter(Boolean);
  const duplicateCode = codes.length !== new Set(codes).size;
  const incomplete = rows.some((r) => r.code.trim().length < 2 || r.description.trim().length < 10);
  const canSave = dirty && !duplicateCode && !incomplete;

  const set = (i: number, field: keyof CplItem, v: string) => {
    setRows((prev) => prev.map((row, idx) => {
      if (idx !== i) return row;
      if (field === "category") return { ...row, category: (v || null) as CplCategory | null };
      return { ...row, [field]: v };
    }));
  };

  const add = () => setRows((prev) => [
    ...prev,
    { code: `CPL${prev.length + 1}`, description: "", category: null },
  ]);
  const remove = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i));

  const save = useMutation({
    mutationFn: () => updateProgramCpl(slug, rows.map((r) => ({
      code: r.code.trim(),
      description: r.description.trim(),
      category: r.category ?? null,
    }))),
    onSuccess: (res) => {
      setError(null);
      setMsg(res.message ?? "CPL tersimpan.");
      setRows(res.data.cpl);
      setBaseline(res.data.cpl);
      qc.invalidateQueries({ queryKey: ["admin-programs"] });
      qc.invalidateQueries({ queryKey: ["programs"] });
    },
    onError: (e: unknown) => { setMsg(null); setError(e); },
  });

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Text weight="semibold">CPL — {label}</Text>
          <Text type="supporting">
            Capaian Pembelajaran Lulusan program studi. Tercetak di sampul RPS dan dipakai AI
            sebagai acuan saat menurunkan CPMK.
          </Text>
        </div>
        {dirty && <Badge variant="warning">Belum disimpan</Badge>}
      </div>

      <div className="mt-4 grid gap-3">
        {rows.length === 0 && (
          <Text type="supporting">Belum ada CPL. Tambahkan minimal satu butir.</Text>
        )}

        {rows.map((row, i) => {
          const codeDuplicate = row.code.trim() !== ""
            && codes.filter((c) => c === row.code.trim().toUpperCase()).length > 1;
          return (
            <div
              key={`cpl-row-${i}`}
              className="grid gap-2 rounded-lg border border-border bg-muted/20 p-3 md:grid-cols-[130px_1fr_190px_auto] md:items-start"
            >
              <TextInput
                label="Kode"
                value={row.code}
                onChange={(v) => set(i, "code", v)}
                placeholder="CPL1"
                status={codeDuplicate ? { type: "error", message: "Kode ganda" } : undefined}
              />
              <TextInput
                label="Deskripsi"
                value={row.description}
                onChange={(v) => set(i, "description", v)}
                placeholder="Mampu menerapkan …"
                status={
                  row.description.trim().length > 0 && row.description.trim().length < 10
                    ? { type: "error", message: "Minimal 10 karakter" }
                    : undefined
                }
              />
              <Selector
                label="Kategori SN-Dikti"
                value={row.category ?? ""}
                onChange={(v) => set(i, "category", v)}
                options={CPL_CATEGORY_OPTIONS}
              />
              <div className="flex items-end md:pt-6">
                <Button label="Hapus" variant="secondary" size="sm" onClick={() => remove(i)} />
              </div>
            </div>
          );
        })}

        {duplicateCode && <Banner status="error">Kode CPL tidak boleh duplikat.</Banner>}
        {msg && <Banner status="success">{msg}</Banner>}
        {error !== null && <Banner status="error">{errorMessage(error)}</Banner>}

        <div className="flex flex-wrap gap-2">
          <Button label="Tambah CPL" variant="secondary" size="sm" onClick={add} />
          <Button
            label={save.isPending ? "Menyimpan…" : "Simpan CPL"}
            variant="primary"
            isLoading={save.isPending}
            isDisabled={!canSave}
            onClick={() => save.mutate()}
          />
          <Button
            label="Batalkan perubahan"
            variant="secondary"
            isDisabled={!dirty}
            onClick={() => setRows(baseline)}
          />
        </div>
      </div>
    </Card>
  );
}
