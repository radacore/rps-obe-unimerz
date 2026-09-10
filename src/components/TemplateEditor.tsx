import { useEffect, useRef, useState } from "react";
import { Card } from "./ui/Card";
import { Button } from "@astryxdesign/core/Button";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import type { Cp } from "@/lib/contoh";

type Props = {
  description: string;
  bahanKajian: string[];
  pustakaUtama: string[];
  pustakaPendukung: string[];
  cpl: Cp[];
  cpmk: Cp[];
  subCpmk: Cp[];
  onChange: (next: {
    description: string;
    bahan_kajian: string[];
    pustaka_utama: string[];
    pustaka_pendukung: string[];
    cpl: Cp[];
    cpmk: Cp[];
    sub_cpmk: Cp[];
  }) => void;
  onSave?: (next: {
    description: string;
    bahan_kajian: string[];
    pustaka_utama: string[];
    pustaka_pendukung: string[];
    cpl: Cp[];
    cpmk: Cp[];
    sub_cpmk: Cp[];
  }) => void;
  collapsedDefault?: boolean;
};

function LinesEditor({ label, value, onChange, placeholder }: { label: string; value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [text, setText] = useState(value.join("\n"));
  useEffect(() => setText(value.join("\n")), [value.join("\n")]);
  return (
    <div className="grid gap-1.5">
      <Text weight="semibold" type="supporting">{label}</Text>
      <textarea
        className="min-h-[96px] w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-primary placeholder:text-secondary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        rows={Math.min(14, Math.max(4, value.length + 1))}
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => onChange(text.split("\n").map((s) => s.trim()).filter(Boolean))}
      />
      <Text type="supporting">Satu baris = satu entri (akan dijaga verbatim — termasuk typo).</Text>
    </div>
  );
}

function CpEditor({ title, rows, onChange, codeLabel }: { title: string; rows: Cp[]; onChange: (v: Cp[]) => void; codeLabel: string }) {
  const set = (i: number, field: "code" | "description", v: string) => {
    const n = rows.map((r) => ({ ...r }));
    (n[i] as Record<string, string>)[field] = v;
    onChange(n);
  };
  const add = () => onChange([...rows, { code: "", description: "" }]);
  const del = (i: number) => onChange(rows.filter((_, j) => j !== i));
  return (
    <div className="grid gap-2 rounded-lg border border-border bg-muted/20 p-3">
      <Text weight="semibold">{title}</Text>
      {rows.map((r, i) => (
        <div key={i} className="grid gap-2 rounded border border-border bg-surface p-2 md:grid-cols-[160px_1fr_auto]">
          <TextInput label={codeLabel} value={r.code} onChange={(v) => set(i, "code", v)} />
          <TextInput label="Deskripsi" value={r.description} onChange={(v) => set(i, "description", v)} />
          <div className="flex items-end"><Button label="Hapus" variant="secondary" size="sm" onClick={() => del(i)} /></div>
        </div>
      ))}
      <Button label="Tambah baris" variant="secondary" size="sm" onClick={add} />
    </div>
  );
}

export function TemplateEditor({ description, bahanKajian, pustakaUtama, pustakaPendukung, cpl, cpmk, subCpmk, onChange, onSave, collapsedDefault }: Props) {
  const [collapsed, setCollapsed] = useState(!!collapsedDefault);
  const [d, setD] = useState(description);
  const [bahan, setBahan] = useState(bahanKajian);
  const [pu, setPu] = useState(pustakaUtama);
  const [pp, setPp] = useState(pustakaPendukung);
  const [cplS, setCplS] = useState(cpl);
  const [cpmkS, setCpmkS] = useState(cpmk);
  const [subS, setSubS] = useState(subCpmk);

  useEffect(() => setD(description), [description]);
  useEffect(() => setBahan(bahanKajian), [JSON.stringify(bahanKajian)]);
  useEffect(() => setPu(pustakaUtama), [JSON.stringify(pustakaUtama)]);
  useEffect(() => setPp(pustakaPendukung), [JSON.stringify(pustakaPendukung)]);
  useEffect(() => setCplS(cpl), [JSON.stringify(cpl)]);
  useEffect(() => setCpmkS(cpmk), [JSON.stringify(cpmk)]);
  useEffect(() => setSubS(subCpmk), [JSON.stringify(subCpmk)]);

  const skipEmitRef = useRef(true);
  const dRef = useRef(d);
  const bahanRef = useRef(bahan);
  const puRef = useRef(pu);
  const ppRef = useRef(pp);
  const cplRef = useRef(cplS);
  const cpmkRef = useRef(cpmkS);
  const subRef = useRef(subS);
  useEffect(() => { dRef.current = d; }, [d]);
  useEffect(() => { bahanRef.current = bahan; }, [bahan]);
  useEffect(() => { puRef.current = pu; }, [pu]);
  useEffect(() => { ppRef.current = pp; }, [pp]);
  useEffect(() => { cplRef.current = cplS; }, [cplS]);
  useEffect(() => { cpmkRef.current = cpmkS; }, [cpmkS]);
  useEffect(() => { subRef.current = subS; }, [subS]);
  const notifyLive = () => {
    onChange({
      description: dRef.current,
      bahan_kajian: bahanRef.current,
      pustaka_utama: puRef.current,
      pustaka_pendukung: ppRef.current,
      cpl: cplRef.current,
      cpmk: cpmkRef.current,
      sub_cpmk: subRef.current,
    });
  };
  // Skip first render; thereafter any user edit triggers live preview. Prop sync updates reset skip flag.
  useEffect(() => { skipEmitRef.current = true; }, [description, JSON.stringify(bahanKajian), JSON.stringify(pustakaUtama), JSON.stringify(pustakaPendukung), JSON.stringify(cpl), JSON.stringify(cpmk), JSON.stringify(subCpmk)]);
  useEffect(() => {
    if (skipEmitRef.current) { skipEmitRef.current = false; return; }
    notifyLive();
  }, [d, JSON.stringify(bahan), JSON.stringify(pu), JSON.stringify(pp), JSON.stringify(cplS), JSON.stringify(cpmkS), JSON.stringify(subS)]);

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <div>
          <Text weight="semibold">Isi template (R23, R24, R26, R28, CPL/CPMK/Sub-CPMK)</Text>
          <Text type="supporting">Editor verbatim — termasuk typo CONTOH (mis. Sbu-CPMK-5) — tampil di pratinjau & download.</Text>
        </div>
        <Button label={collapsed ? "Buka" : "Tutup"} variant="secondary" size="sm" onClick={() => setCollapsed((v) => !v)} />
      </div>
      {!collapsed && (
        <div className="mt-4 grid gap-4">
          <div className="grid gap-1.5">
            <Text weight="semibold" type="supporting">Deskripsi singkat (R23) — 3–5 baris</Text>
            <textarea
              className="min-h-[96px] w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm leading-relaxed text-primary placeholder:text-secondary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              rows={3}
              value={d}
              placeholder="Ringkasan singkat mata kuliah…"
              onChange={(e) => setD(e.target.value)}
            />
          </div>
          <LinesEditor label="Bahan kajian (R24) — tiap baris satu bullet" value={bahan} onChange={(v) => setBahan(v)} placeholder="Biologi Sel…&#10;Biolistrik…" />
          <LinesEditor label="Pustaka utama (R26)" value={pu} onChange={(v) => setPu(v)} />
          <LinesEditor label="Pustaka pendukung (R28)" value={pp} onChange={(v) => setPp(v)} />
          <CpEditor title="CPL (R07-08)" rows={cplS} onChange={(v) => setCplS(v)} codeLabel="Kode CPL" />
          <CpEditor title="CPMK (R10-13)" rows={cpmkS} onChange={(v) => setCpmkS(v)} codeLabel="Kode CPMK" />
          <CpEditor title="Sub-CPMK (R15-21)" rows={subS} onChange={(v) => setSubS(v)} codeLabel="Kode Sub-CPMK" />
          {onSave && (
            <div className="flex gap-2">
              <Button
                label="Simpan"
                variant="primary"
                size="sm"
                onClick={() => onSave({ description: d, bahan_kajian: bahan, pustaka_utama: pu, pustaka_pendukung: pp, cpl: cplS, cpmk: cpmkS, sub_cpmk: subS })}
              />
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
