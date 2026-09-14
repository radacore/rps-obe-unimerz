import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import { Grid } from "@astryxdesign/core/Grid";
import { ApiError } from "@/lib/api";
import {
  TAXONOMY_OPTIONS, createCourse, deleteCourse, fetchCourses, updateCourse, updateCourseCpmk,
  type AdminProgram, type Course, type CpmkItem, type NewCourseInput,
} from "@/lib/admin";
import { Badge } from "./ui/Badge";
import { Banner } from "./ui/Banner";
import { Panel } from "./ui/Panel";
import { Textarea } from "./ui/Textarea";
import { LinesEditor } from "./ui/LinesEditor";

function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const first = Object.values(e.fieldErrors)[0]?.[0];
    if (first) return first;
  }
  return e instanceof Error ? e.message : String(e);
}

const EMPTY_COURSE = {
  code: "", name: "", semester: 1, sks_theory: 2, sks_practice: 0,
};

/** TextInput Astryx hanya mendukung text/password/email, jadi angka disaring di sini. */
function NumberInput({
  label, value, onChange, min = 0, max = 12,
}: { label: string; value: number; onChange: (n: number) => void; min?: number; max?: number }) {
  return (
    <TextInput
      label={label}
      value={String(value)}
      onChange={(v) => {
        const digits = v.replace(/\D/g, "");
        const next = digits === "" ? min : Number(digits);
        onChange(Math.max(min, Math.min(max, next)));
      }}
    />
  );
}

/**
 * Bank kurikulum sebuah program studi: daftar mata kuliah beserta CPMK-nya.
 *
 * Di sinilah CPMK seharusnya berada. Secara OBE, CPL dimiliki program studi,
 * sedangkan CPMK adalah capaian sebuah mata kuliah yang memetakan ke CPL —
 * sehingga bisa dipakai ulang oleh setiap RPS mata kuliah tersebut.
 */
export function CurriculumPanel({ program }: { program: AdminProgram }) {
  const qc = useQueryClient();
  const courses = useQuery({
    queryKey: ["admin-courses", program.slug],
    queryFn: () => fetchCourses(program.slug),
    throwOnError: false,
  });

  const rows = useMemo(() => courses.data?.data ?? [], [courses.data]);
  const [draft, setDraft] = useState<typeof EMPTY_COURSE>(EMPTY_COURSE);
  const [createError, setCreateError] = useState<unknown>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  const canCreate = draft.code.trim().length >= 3
    && draft.name.trim().length >= 3
    && draft.sks_theory + draft.sks_practice > 0;

  const create = useMutation({
    mutationFn: () => {
      const payload: NewCourseInput = {
        study_program_slug: program.slug,
        code: draft.code.trim(),
        name: draft.name.trim(),
        semester: draft.semester,
        sks_theory: draft.sks_theory,
        sks_practice: draft.sks_practice,
      };
      return createCourse(payload);
    },
    onSuccess: (res) => {
      setCreateError(null);
      setDraft(EMPTY_COURSE);
      setOpenId(res.data.id);
      qc.invalidateQueries({ queryKey: ["admin-courses", program.slug] });
      qc.invalidateQueries({ queryKey: ["admin-matrix", program.slug] });
      qc.invalidateQueries({ queryKey: ["admin-audit"] });
    },
    onError: (e: unknown) => setCreateError(e),
  });

  const totalSks = rows.reduce((n, r) => n + r.sks_total, 0);

  return (
    <VStack gap={4}>
      <Panel
        title={`Tambah mata kuliah — ${program.label}`}
        description="Kode mata kuliah unik di dalam prodi ini. CPMK diisi setelah mata kuliah dibuat."
      >
        <VStack gap={3}>
          <Grid columns={{ minWidth: 180 }} gap={3} align="end">
            <TextInput label="Kode" value={draft.code} onChange={(v) => setDraft({ ...draft, code: v })} placeholder="IK24IK1201" />
            <TextInput label="Nama mata kuliah" value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} placeholder="Algoritma dan Struktur Data" />
            <Selector
              label="Semester"
              value={String(draft.semester)}
              onChange={(v) => setDraft({ ...draft, semester: Number(v) })}
              options={Array.from({ length: 14 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))}
            />
            <NumberInput label="SKS Teori" value={draft.sks_theory} onChange={(n) => setDraft({ ...draft, sks_theory: n })} />
            <NumberInput label="SKS Praktik" value={draft.sks_practice} onChange={(n) => setDraft({ ...draft, sks_practice: n })} />
            <HStack justify="end">
              <Button
                label={create.isPending ? "Menambah…" : "Tambah"}
                variant="primary"
                isLoading={create.isPending}
                isDisabled={!canCreate}
                onClick={() => create.mutate()}
              />
            </HStack>
          </Grid>
          {createError !== null && <Banner status="error">{errorMessage(createError)}</Banner>}
        </VStack>
      </Panel>

      <Panel
        title={`Kurikulum ${program.label}`}
        actions={<Text type="supporting">{`${rows.length} mata kuliah · ${totalSks} SKS`}</Text>}
      >
        <VStack gap={2}>
          {courses.isLoading && <Text type="supporting">Memuat kurikulum…</Text>}
          {courses.isError && <Banner status="error">{errorMessage(courses.error)}</Banner>}
          {!courses.isLoading && rows.length === 0 && (
            <Text type="supporting">
              Belum ada mata kuliah. Tambahkan dari formulir di atas — setelah itu CPMK bisa disusun
              dan dipakai ulang oleh setiap RPS mata kuliah tersebut.
            </Text>
          )}
          {rows.map((course) => (
            <CourseRow
              key={course.id}
              course={course}
              programSlug={program.slug}
              programCplCodes={program.cpl.map((x) => x.code)}
              isOpen={openId === course.id}
              onToggle={() => setOpenId(openId === course.id ? null : course.id)}
            />
          ))}
        </VStack>
      </Panel>
    </VStack>
  );
}

function CourseRow({
  course, programSlug, programCplCodes, isOpen, onToggle,
}: {
  course: Course;
  programSlug: string;
  programCplCodes: string[];
  isOpen: boolean;
  onToggle: () => void;
}) {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!msg && !error) return;
    const t = setTimeout(() => { setMsg(null); setError(null); }, 4000);
    return () => clearTimeout(t);
  }, [msg, error]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-courses", programSlug] });
    qc.invalidateQueries({ queryKey: ["admin-matrix", programSlug] });
    qc.invalidateQueries({ queryKey: ["admin-audit"] });
  };

  const remove = useMutation({
    mutationFn: () => deleteCourse(course.id),
    onSuccess: (res) => { setError(null); setMsg(res.message ?? "Dihapus."); invalidate(); },
    onError: (e: unknown) => { setMsg(null); setError(e); setConfirmDelete(false); },
  });

  return (
    <Panel padding={3}>
      <VStack gap={2}>
        <HStack justify="between" align="start" gap={2} wrap="wrap">
          <VStack gap={0}>
            <Text weight="semibold">{course.code} — {course.name}</Text>
            <Text type="supporting">
              Semester {course.semester} · T{course.sks_theory}/P{course.sks_practice} ({course.sks_total} SKS)
              {course.is_elective ? " · pilihan" : ""}
            </Text>
          </VStack>
          <HStack align="center" gap={1} wrap="wrap">
            <Badge variant={course.cpmk_count > 0 ? "success" : "warning"}>
              {`${course.cpmk_count} CPMK`}
            </Badge>
            <Badge variant="default">{`${course.sub_cpmk_count} Sub-CPMK`}</Badge>
            <Button label={isOpen ? "Tutup" : "Kelola CPMK"} variant="secondary" size="sm" onClick={onToggle} />
            {confirmDelete ? (
              <>
                <Button label="Ya, hapus" variant="destructive" size="sm" isLoading={remove.isPending} onClick={() => remove.mutate()} />
                <Button label="Batal" variant="ghost" size="sm" onClick={() => setConfirmDelete(false)} />
              </>
            ) : (
              <Button label="Hapus" variant="ghost" size="sm" onClick={() => setConfirmDelete(true)} />
            )}
          </HStack>
        </HStack>

        {course.cpmk_count === 0 && (
          <Text type="supporting">
            Belum ada CPMK. Tanpa CPMK, mata kuliah ini tidak menopang CPL mana pun di matriks.
          </Text>
        )}
        {msg && <Banner status="success">{msg}</Banner>}
        {error !== null && <Banner status="error">{errorMessage(error)}</Banner>}

        {isOpen && (
          <CpmkEditor
            key={`cpmk-${course.id}-${course.updated_at}`}
            course={course}
            programSlug={programSlug}
            programCplCodes={programCplCodes}
          />
        )}
        {isOpen && <CourseDetailEditor key={`detail-${course.id}`} course={course} programSlug={programSlug} />}
      </VStack>
    </Panel>
  );
}

/** Deskripsi, bahan kajian, dan pustaka — sumber isi RPS saat autofill. */
function CourseDetailEditor({ course, programSlug }: { course: Course; programSlug: string }) {
  const qc = useQueryClient();
  const [description, setDescription] = useState(course.description ?? "");
  const [bahan, setBahan] = useState<string[]>(course.bahan_kajian);
  const [utama, setUtama] = useState<string[]>(course.pustaka_utama);
  const [pendukung, setPendukung] = useState<string[]>(course.pustaka_pendukung);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const [baseline, setBaseline] = useState({
    description: course.description ?? "",
    bahan: course.bahan_kajian,
    utama: course.pustaka_utama,
    pendukung: course.pustaka_pendukung,
  });

  useEffect(() => {
    if (!msg && !error) return;
    const t = setTimeout(() => { setMsg(null); setError(null); }, 4000);
    return () => clearTimeout(t);
  }, [msg, error]);

  const dirty = description !== baseline.description
    || JSON.stringify(bahan) !== JSON.stringify(baseline.bahan)
    || JSON.stringify(utama) !== JSON.stringify(baseline.utama)
    || JSON.stringify(pendukung) !== JSON.stringify(baseline.pendukung);

  const save = useMutation({
    mutationFn: () => updateCourse(course.id, {
      description: description.trim() ? description.trim() : null,
      bahan_kajian: bahan,
      pustaka_utama: utama,
      pustaka_pendukung: pendukung,
    }),
    onSuccess: (res) => {
      setError(null);
      setMsg(res.message ?? "Tersimpan.");
      setBaseline({
        description: res.data.description ?? "",
        bahan: res.data.bahan_kajian,
        utama: res.data.pustaka_utama,
        pendukung: res.data.pustaka_pendukung,
      });
      qc.invalidateQueries({ queryKey: ["admin-courses", programSlug] });
      qc.invalidateQueries({ queryKey: ["admin-audit"] });
    },
    onError: (e: unknown) => { setMsg(null); setError(e); },
  });

  return (
    <Panel
      title="Deskripsi & pustaka"
      headingLevel={4}
      padding={3}
      actions={dirty ? <Badge variant="warning">Belum disimpan</Badge> : undefined}
    >
      <VStack gap={3}>
        <Text type="supporting">Isi ini yang dipakai saat sebuah RPS diisi dari kurikulum.</Text>

        <Textarea
          label="Deskripsi singkat MK"
          value={description}
          onChange={setDescription}
          placeholder="Mata kuliah ini membahas …"
          minRows={3}
        />

        <LinesEditor label="Bahan kajian" hint="Satu topik per baris" value={bahan} onChange={setBahan} />
        <LinesEditor label="Pustaka utama" hint="Satu referensi per baris" value={utama} onChange={setUtama} />
        <LinesEditor label="Pustaka pendukung" hint="Satu referensi per baris" value={pendukung} onChange={setPendukung} />

        {msg && <Banner status="success">{msg}</Banner>}
        {error !== null && <Banner status="error">{errorMessage(error)}</Banner>}

        <HStack>
          <Button
            label={save.isPending ? "Menyimpan…" : "Simpan deskripsi & pustaka"}
            variant="primary"
            size="sm"
            isLoading={save.isPending}
            isDisabled={!dirty}
            onClick={() => save.mutate()}
          />
        </HStack>
      </VStack>
    </Panel>
  );
}

function CpmkEditor({
  course, programSlug, programCplCodes,
}: { course: Course; programSlug: string; programCplCodes: string[] }) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<CpmkItem[]>(course.cpmk);
  const [baseline, setBaseline] = useState<CpmkItem[]>(course.cpmk);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!msg && !error) return;
    const t = setTimeout(() => { setMsg(null); setError(null); }, 4000);
    return () => clearTimeout(t);
  }, [msg, error]);

  const dirty = JSON.stringify(rows) !== JSON.stringify(baseline);
  const codes = rows.map((r) => r.code.trim().toUpperCase()).filter(Boolean);
  const duplicate = codes.length !== new Set(codes).size;
  const incomplete = rows.some((r) => r.code.trim().length < 2 || r.description.trim().length < 10
    || r.sub_cpmk.some((s) => s.code.trim().length < 2 || s.description.trim().length < 10));

  const cplOptions = [
    { value: "", label: "— belum dipetakan —" },
    ...programCplCodes.map((code) => ({ value: code, label: code })),
  ];

  const setCpmk = (i: number, patch: Partial<CpmkItem>) =>
    setRows((prev) => prev.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));

  const setSub = (i: number, j: number, patch: Partial<CpmkItem["sub_cpmk"][number]>) =>
    setRows((prev) => prev.map((row, idx) => idx !== i ? row : {
      ...row,
      sub_cpmk: row.sub_cpmk.map((sub, sIdx) => (sIdx === j ? { ...sub, ...patch } : sub)),
    }));

  const save = useMutation({
    mutationFn: () => updateCourseCpmk(course.id, rows.map((r) => ({
      code: r.code.trim(),
      description: r.description.trim(),
      taxonomy: r.taxonomy || null,
      cpl_code: r.cpl_code || null,
      sub_cpmk: r.sub_cpmk.map((s) => ({
        code: s.code.trim(),
        description: s.description.trim(),
        taxonomy: s.taxonomy || null,
      })),
    }))),
    onSuccess: (res) => {
      setError(null);
      setMsg(res.message ?? "CPMK tersimpan.");
      setRows(res.data.cpmk);
      setBaseline(res.data.cpmk);
      qc.invalidateQueries({ queryKey: ["admin-courses", programSlug] });
      qc.invalidateQueries({ queryKey: ["admin-matrix", programSlug] });
      qc.invalidateQueries({ queryKey: ["admin-audit"] });
    },
    onError: (e: unknown) => { setMsg(null); setError(e); },
  });

  return (
    <Panel
      title={`CPMK — ${course.code}`}
      headingLevel={4}
      padding={3}
      actions={dirty ? <Badge variant="warning">Belum disimpan</Badge> : undefined}
    >
      <VStack gap={3}>
        {programCplCodes.length === 0 && (
          <Banner status="warning">
            Prodi ini belum punya CPL. Isi tab CPL Prodi lebih dulu agar CPMK bisa dipetakan.
          </Banner>
        )}

        {rows.map((cpmk, i) => (
          <Panel key={`cpmk-${i}-${cpmk.code || "baru"}`} padding={3}>
            <VStack gap={2}>
              <Grid columns={{ minWidth: 160 }} gap={2} align="start">
                <TextInput label="Kode CPMK" value={cpmk.code} onChange={(v) => setCpmk(i, { code: v })} placeholder="CPMK 1" />
                <TextInput label={`Rumusan ${cpmk.code || "CPMK"}`} value={cpmk.description} onChange={(v) => setCpmk(i, { description: v })} placeholder="Mampu menganalisis …" />
                <Selector label="Taksonomi" value={cpmk.taxonomy ?? ""} onChange={(v) => setCpmk(i, { taxonomy: v || null })} options={TAXONOMY_OPTIONS} />
                <Selector label="Menopang CPL" value={cpmk.cpl_code ?? ""} onChange={(v) => setCpmk(i, { cpl_code: v || null })} options={cplOptions} />
                <HStack justify="end" align="end">
                  <Button label="Hapus" variant="secondary" size="sm" onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))} />
                </HStack>
              </Grid>

              <VStack gap={2}>
                <Text type="supporting">Sub-CPMK — tahapan kemampuan per pertemuan</Text>
                {cpmk.sub_cpmk.map((sub, j) => (
                  <Grid key={`sub-${i}-${j}-${sub.code || "baru"}`} columns={{ minWidth: 160 }} gap={2} align="start">
                    <TextInput label="Kode Sub-CPMK" value={sub.code} onChange={(v) => setSub(i, j, { code: v })} placeholder="Sub-CPMK-1" />
                    <TextInput label={`Rumusan ${sub.code || "Sub-CPMK"}`} value={sub.description} onChange={(v) => setSub(i, j, { description: v })} placeholder="Mahasiswa mampu …" />
                    <Selector label="Taksonomi" value={sub.taxonomy ?? ""} onChange={(v) => setSub(i, j, { taxonomy: v || null })} options={TAXONOMY_OPTIONS} />
                    <HStack justify="end" align="end">
                      <Button
                        label="Hapus"
                        variant="ghost"
                        size="sm"
                        onClick={() => setCpmk(i, { sub_cpmk: cpmk.sub_cpmk.filter((_, sIdx) => sIdx !== j) })}
                      />
                    </HStack>
                  </Grid>
                ))}
                <HStack>
                  <Button
                    label="Tambah Sub-CPMK"
                    variant="ghost"
                    size="sm"
                    onClick={() => setCpmk(i, {
                      sub_cpmk: [...cpmk.sub_cpmk, {
                        code: `Sub-CPMK-${cpmk.sub_cpmk.length + 1}`, description: "", taxonomy: null,
                      }],
                    })}
                  />
                </HStack>
              </VStack>
            </VStack>
          </Panel>
        ))}

        {duplicate && <Banner status="error">Kode CPMK tidak boleh duplikat.</Banner>}
        {msg && <Banner status="success">{msg}</Banner>}
        {error !== null && <Banner status="error">{errorMessage(error)}</Banner>}

        <HStack gap={2} wrap="wrap">
          <Button
            label="Tambah CPMK"
            variant="secondary"
            size="sm"
            onClick={() => setRows((prev) => [...prev, {
              code: `CPMK ${prev.length + 1}`, description: "", taxonomy: null, cpl_code: null, sub_cpmk: [],
            }])}
          />
          <Button
            label={save.isPending ? "Menyimpan…" : "Simpan CPMK"}
            variant="primary"
            size="sm"
            isLoading={save.isPending}
            isDisabled={!dirty || duplicate || incomplete}
            onClick={() => save.mutate()}
          />
          <Button label="Batalkan perubahan" variant="ghost" size="sm" isDisabled={!dirty} onClick={() => setRows(baseline)} />
        </HStack>
      </VStack>
    </Panel>
  );
}
