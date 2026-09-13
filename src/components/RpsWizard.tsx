import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { DateInput } from "@astryxdesign/core/DateInput";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { api, ApiError, type ApiOk } from "@/lib/api";
import {
  ADMIN_SESSION_KEY, fetchAdminSession, fetchPublicCourses,
  type Course,
} from "@/lib/admin";
import { useFaculties } from "@/lib/useFaculties";
import {
  CANONICAL_WEEKS, STEP_IDS, STEP_LABELS, flattenCurriculumCpmk, incompleteSteps,
  initialFormState, isReadyToPublish, stepIssues, toApiPayload,
  type ContentSource, type CpItem, type LecturerRole, type RpsFormState, type StepId, type WeeklyRow,
  aiDraftToForm,
  type AiDraftResult,
} from "@/lib/rps-wizard";
import { Badge } from "./ui/Badge";
import { Banner } from "./ui/Banner";
import { Card } from "./ui/Card";
import { LinesEditor } from "./ui/LinesEditor";

const LECTURER_ROLES: { value: LecturerRole; label: string }[] = [
  { value: "koordinator_mk", label: "Koordinator MK" },
  { value: "pengembang", label: "Pengembang RPS" },
  { value: "ketua_prodi", label: "Ketua Prodi" },
  { value: "anggota", label: "Anggota" },
];

const SEMESTER_OPTIONS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"]
  .map((v) => ({ value: v, label: v }));

function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const first = Object.values(e.fieldErrors)[0]?.[0];
    if (first) return first;
  }
  return e instanceof Error ? e.message : String(e);
}

/** TextInput Astryx hanya menerima text/password/email, jadi angka disaring di sini. */
function NumberField({
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
 * Wizard pembuatan RPS.
 *
 * Sebelumnya isian terpecah dua halaman: identitas di formulir awal, sisanya di
 * halaman detail bersama enam panel sejajar tanpa urutan. Sekarang seluruh isi
 * disusun berurutan di satu tempat, dan dokumen baru diterbitkan setelah semua
 * langkah lengkap.
 */
export function RpsWizard() {
  const qc = useQueryClient();
  const nav = useNavigate();

  const session = useQuery({ queryKey: ADMIN_SESSION_KEY, queryFn: fetchAdminSession, retry: false });
  const identity = session.data ?? null;
  const { facultyOptions, prodisForFaculty } = useFaculties();

  const [form, setForm] = useState<RpsFormState | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [error, setError] = useState<unknown>(null);

  // Nilai awal diturunkan dari sesi begitu identitas diketahui: dosen hampir
  // selalu menulis untuk prodinya sendiri. Dihitung saat render, bukan lewat
  // efek yang memicu render kedua.
  const effectiveForm: RpsFormState = form ?? initialFormState(
    identity
      ? {
          faculty: identity.facultyLabel ?? "",
          study_program: identity.studyProgramLabel ?? "",
          lecturers: [{ name: identity.name, nidn: identity.nidn, role: "koordinator_mk" }],
        }
      : undefined,
  );

  const prodiOptions = useMemo(
    () => prodisForFaculty(effectiveForm.faculty).map((p) => ({ value: p.value, label: p.label })),
    [effectiveForm.faculty, prodisForFaculty],
  );

  const patch = (next: Partial<RpsFormState>) =>
    setForm((prev) => ({ ...(prev ?? effectiveForm), ...next }));

  const stepId = STEP_IDS[stepIndex];
  const issuesByStep = useMemo(
    () => Object.fromEntries(STEP_IDS.map((id) => [id, stepIssues(effectiveForm, id)])) as Record<StepId, string[]>,
    [effectiveForm],
  );
  const pending = useMemo(() => incompleteSteps(effectiveForm), [effectiveForm]);
  // Slug prodi dipakai memanggil endpoint kesiapan katalog. Wizard menyimpan
  // value; slug dicari dari data useFaculties agar konsisten dengan dropdown.
  const prodiSlug = useMemo(() => {
    const list = prodisForFaculty(effectiveForm.faculty);
    return list.find((p) => p.value === effectiveForm.study_program)?.slug ?? null;
  }, [effectiveForm.faculty, effectiveForm.study_program, prodisForFaculty]);
  const readiness = useQuery({
    queryKey: ["program-readiness", prodiSlug],
    queryFn: () => api<ApiOk<{
      ready: boolean;
      label: string;
      issues: { code: string; message: string }[];
    }>>(`/api/programs/${prodiSlug}/readiness`),
    enabled: !!prodiSlug,
    staleTime: 60_000,
  });
  const catalogReady = readiness.data?.data.ready ?? true;
  const catalogIssues = readiness.data?.data.issues ?? [];
  // Terbit hanya kalau semua langkah wizard lengkap DAN katalog prodi lengkap.
  // Tombol UI dan server memakai aturan yang sama supaya tidak ada kejutan.
  const ready = isReadyToPublish(effectiveForm) && catalogReady;

  const publish = useMutation({
    mutationFn: () => api<ApiOk<{ id: number }>>("/api/rps", {
      method: "POST",
      body: JSON.stringify(toApiPayload(effectiveForm)),
    }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["rps"] });
      nav({ to: "/rps/$id", params: { id: String(res.data.id) } });
    },
    onError: (e: unknown) => setError(e),
  });

  if (session.isLoading) return <Text type="supporting">Memuat sesi…</Text>;

  if (!identity) {
    return (
      <Card>
        <Text weight="semibold">Masuk untuk membuat RPS</Text>
        <Text type="supporting">Menulis RPS memerlukan akun dosen atau pengelola.</Text>
        <div className="mt-3"><Link to="/admin/login" className="text-sm text-accent">Ke halaman masuk →</Link></div>
      </Card>
    );
  }

  // Kebijakan institusi: penulis memakai kunci AI miliknya sendiri. Dinyatakan
  // sekali di sini; setelah kunci ada, tidak diungkit lagi di langkah mana pun.
  if (identity.has_api_key === false) {
    return (
      <Card>
        <Text weight="semibold">Simpan API key Anda dulu</Text>
        <Text type="supporting">
          Setiap penulis RPS memakai kunci AI miliknya sendiri, sehingga biaya dan kuota melekat
          pada pemakainya.
        </Text>
        <div className="mt-3">
          <Link to="/settings" className="text-sm text-accent">Buka Settings untuk menyimpan API key →</Link>
        </div>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      <StepNav
        stepIndex={stepIndex}
        onStep={setStepIndex}
        issuesByStep={issuesByStep}
      />

      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Text weight="semibold">
            Langkah {stepIndex + 1} dari {STEP_IDS.length} — {STEP_LABELS[stepId]}
          </Text>
          {issuesByStep[stepId].length === 0
            ? <Badge variant="success">Lengkap</Badge>
            : <Badge variant="warning">{issuesByStep[stepId].length} perlu diisi</Badge>}
        </div>

        <div className="mt-4">
          {stepId === "identitas" && (
            <IdentityStep
              form={effectiveForm} patch={patch}
              facultyOptions={facultyOptions} prodiOptions={prodiOptions}
              onFacultyChange={(v) => {
                const list = prodisForFaculty(v);
                patch({
                  faculty: v,
                  study_program: list.some((p) => p.value === effectiveForm.study_program)
                    ? effectiveForm.study_program
                    : list[0]?.value ?? "",
                });
              }}
            />
          )}
          {stepId === "sumber" && <SourceStep form={effectiveForm} patch={patch} />}
          {stepId === "deskripsi" && <DescriptionStep form={effectiveForm} patch={patch} />}
          {stepId === "capaian" && <OutcomeStep form={effectiveForm} patch={patch} />}
          {stepId === "mingguan" && <WeeklyStep form={effectiveForm} patch={patch} />}
          {stepId === "tinjau" && (
            <ReviewStep
              form={effectiveForm}
              pending={pending}
              onGoTo={(id) => setStepIndex(STEP_IDS.indexOf(id))}
              catalogReady={catalogReady}
              catalogIssues={catalogIssues}
              catalogLabel={readiness.data?.data.label ?? null}
            />
          )}
        </div>

        {issuesByStep[stepId].length > 0 && stepId !== "tinjau" && (
          <div className="mt-4">
            <Banner status="info" title="Yang masih perlu diisi di langkah ini">
              <ul className="grid gap-1">
                {issuesByStep[stepId].map((issue) => (
                  <li key={issue} className="text-xs">{issue}</li>
                ))}
              </ul>
            </Banner>
          </div>
        )}

        {error !== null && <div className="mt-3"><Banner status="error">{errorMessage(error)}</Banner></div>}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            label="Sebelumnya"
            variant="secondary"
            isDisabled={stepIndex === 0}
            onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
          />
          {stepIndex < STEP_IDS.length - 1 ? (
            <Button
              label="Berikutnya"
              variant="primary"
              onClick={() => setStepIndex((i) => Math.min(STEP_IDS.length - 1, i + 1))}
            />
          ) : (
            <Button
              label={publish.isPending ? "Menerbitkan…" : "Terbitkan RPS"}
              variant="primary"
              isLoading={publish.isPending}
              isDisabled={!ready}
              onClick={() => publish.mutate()}
            />
          )}
          <Text type="supporting">
            {ready
              ? "Semua langkah lengkap — dokumen siap diterbitkan."
              : `${pending.length} langkah belum lengkap.`}
          </Text>
        </div>
      </Card>
    </div>
  );
}

/** Penanda langkah dengan status lengkap/belum, bisa diklik bebas. */
function StepNav({
  stepIndex, onStep, issuesByStep,
}: { stepIndex: number; onStep: (i: number) => void; issuesByStep: Record<StepId, string[]> }) {
  return (
    <Card>
      <div className="flex flex-wrap gap-2">
        {STEP_IDS.map((id, i) => {
          const done = issuesByStep[id].length === 0;
          const active = i === stepIndex;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onStep(i)}
              aria-current={active ? "step" : undefined}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                active
                  ? "border-accent bg-accent-muted text-primary"
                  : "border-border bg-surface text-secondary hover:border-strong"
              }`}
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                  done ? "bg-success text-white" : active ? "bg-accent text-white" : "bg-muted text-secondary"
                }`}
              >
                {done ? "✓" : i + 1}
              </span>
              <span className="whitespace-nowrap">{STEP_LABELS[id]}</span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function IdentityStep({
  form, patch, facultyOptions, prodiOptions, onFacultyChange,
}: {
  form: RpsFormState;
  patch: (n: Partial<RpsFormState>) => void;
  facultyOptions: { value: string; label: string }[];
  prodiOptions: { value: string; label: string }[];
  onFacultyChange: (v: string) => void;
}) {
  const sksTotal = form.sks_theory + form.sks_practice;
  const setLecturer = (i: number, next: Partial<RpsFormState["lecturers"][number]>) =>
    patch({ lecturers: form.lecturers.map((l, idx) => (idx === i ? { ...l, ...next } : l)) });

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-2">
        <TextInput label="Nama mata kuliah" value={form.course_name} onChange={(v) => patch({ course_name: v })} placeholder="Algoritma dan Struktur Data" />
        <TextInput label="Kode mata kuliah" value={form.course_code} onChange={(v) => patch({ course_code: v })} placeholder="IK24IK1201" />
        <Selector label="Fakultas" value={form.faculty} onChange={onFacultyChange} options={[{ value: "", label: "— pilih fakultas —" }, ...facultyOptions]} />
        <Selector
          label="Program studi"
          value={form.study_program}
          onChange={(v) => patch({ study_program: v })}
          options={[{ value: "", label: "— pilih program studi —" }, ...prodiOptions]}
        />
        <Selector label="Semester" value={form.semester} onChange={(v) => patch({ semester: v })} options={[{ value: "", label: "— pilih semester —" }, ...SEMESTER_OPTIONS]} />
        <TextInput label="Rumpun mata kuliah" value={form.course_cluster} onChange={(v) => patch({ course_cluster: v })} description="Kosongkan untuk memakai nama program studi" />
      </div>

      <div className="grid gap-3 md:grid-cols-[140px_140px_1fr] md:items-end">
        <NumberField label="SKS Teori" value={form.sks_theory} onChange={(n) => patch({ sks_theory: n })} />
        <NumberField label="SKS Praktik" value={form.sks_practice} onChange={(n) => patch({ sks_practice: n })} />
        <Text type="supporting">Total {sksTotal} SKS</Text>
      </div>

      <DateInput
        label="Tanggal penyusunan"
        value={form.preparation_date as import("@astryxdesign/core/Calendar").ISODateString}
        onChange={(v) => patch({ preparation_date: v ?? form.preparation_date })}
        format="system_date"
      />

      <div className="grid gap-2">
        <Text weight="semibold">Dosen pengampu</Text>
        <Text type="supporting">
          Wajib ada satu Koordinator MK. Nama dan peran tercetak di kolom Otorisasi dokumen.
        </Text>
        {form.lecturers.map((l, i) => (
          <div key={`lecturer-${i}-${l.nidn}`} className="grid gap-2 rounded-lg border border-border bg-muted/20 p-3 md:grid-cols-[1fr_150px_180px_auto] md:items-end">
            <TextInput label={`Nama dosen ${i + 1}`} value={l.name} onChange={(v) => setLecturer(i, { name: v })} placeholder="Dr. Nama Lengkap, M.Kom." />
            <TextInput
              label="NIDN"
              value={l.nidn}
              onChange={(v) => setLecturer(i, { nidn: v.replace(/\D/g, "").slice(0, 10) })}
              placeholder="0922038401"
              status={l.nidn.length > 0 && l.nidn.length !== 10 ? { type: "error", message: "10 digit" } : undefined}
            />
            <Selector label="Peran" value={l.role} onChange={(v) => setLecturer(i, { role: v as LecturerRole })} options={LECTURER_ROLES} />
            <Button
              label="Hapus"
              variant="secondary"
              size="sm"
              isDisabled={form.lecturers.length === 1}
              onClick={() => patch({ lecturers: form.lecturers.filter((_, idx) => idx !== i) })}
            />
          </div>
        ))}
        <div>
          <Button
            label="Tambah dosen"
            variant="secondary"
            size="sm"
            onClick={() => patch({ lecturers: [...form.lecturers, { name: "", nidn: "", role: "anggota" }] })}
          />
        </div>
      </div>
    </div>
  );
}

/** Langkah 2: menentukan dari mana isi dokumen diambil. */
function SourceStep({ form, patch }: { form: RpsFormState; patch: (n: Partial<RpsFormState>) => void }) {
  const courses = useQuery({
    queryKey: ["public-courses", form.study_program],
    queryFn: () => fetchPublicCourses(form.study_program),
    enabled: !!form.study_program,
    throwOnError: false,
  });
  const rows = useMemo(() => courses.data?.data ?? [], [courses.data]);
  const [applied, setApplied] = useState<string | null>(null);

  const choose = (source: ContentSource) => {
    patch({ source, source_course_id: source === "curriculum" ? form.source_course_id : null });
    setApplied(null);
  };

  const applyCourse = (course: Course) => {
    const { cpmk, sub_cpmk } = flattenCurriculumCpmk(course.cpmk);
    patch({
      source_course_id: course.id,
      course_name: course.name,
      course_code: course.code,
      course_cluster: course.cluster ?? form.course_cluster,
      semester: romanSemester(course.semester),
      sks_theory: course.sks_theory,
      sks_practice: course.sks_practice,
      description: course.description ?? "",
      bahan_kajian: course.bahan_kajian,
      pustaka_utama: course.pustaka_utama,
      pustaka_pendukung: course.pustaka_pendukung,
      cpmk,
      sub_cpmk,
      // Rumusan lengkap dari CPL prodi, bukan hanya kodenya: baris CPL pada
      // dokumen memuat deskripsi, dan kode tanpa rumusan akan tercetak kosong.
      cpl: course.charged_cpl,
    });
    setApplied(`${course.code} diterapkan: ${cpmk.length} CPMK, ${sub_cpmk.length} Sub-CPMK.`);
  };

  const identityReady =
    form.course_name.trim().length >= 3 && form.course_code.trim().length >= 2 && !!form.study_program;

  const [aiError, setAiError] = useState<unknown>(null);
  const [aiApplied, setAiApplied] = useState<string | null>(null);

  const aiDraft = useMutation({
    mutationFn: () => api<ApiOk<AiDraftResult>>("/api/rps/ai/draft", {
      method: "POST",
      body: JSON.stringify({
        course_name: form.course_name,
        course_code: form.course_code,
        study_program: form.study_program,
        semester: form.semester,
        sks_theory: form.sks_theory,
        sks_practice: form.sks_practice,
        ...(form.description.trim() ? { description: form.description.trim() } : {}),
      }),
    }),
    onSuccess: (res) => {
      setAiError(null);
      const g = res.data;
      patch(aiDraftToForm(g));
      setAiApplied(
        `AI menyusun ${g.cpl?.length ?? 0} CPL, ${g.cpmk?.length ?? 0} CPMK, ${g.sub_cpmk?.length ?? 0} Sub-CPMK, ` +
        `dan ${g.weeklyPlans?.length ?? 0} baris rencana mingguan. Periksa langkah 3 sampai 5.`,
      );
    },
    onError: (e: unknown) => { setAiApplied(null); setAiError(e); },
  });

  const OPTIONS: { id: ContentSource; title: string; body: string }[] = [
    {
      id: "curriculum",
      title: "Ambil dari bank kurikulum prodi",
      body: "Paling akurat: CPL, CPMK, dan Sub-CPMK sudah disahkan prodi. Anda tinggal menyusun rencana mingguan.",
    },
    {
      id: "ai",
      title: "Susun dengan bantuan AI",
      body: "Memakai API key Anda sendiri. Hasilnya draf yang tetap perlu Anda periksa dan sunting.",
    },
    {
      id: "manual",
      title: "Isi sendiri sepenuhnya",
      body: "Semua bagian diisi manual pada langkah berikutnya.",
    },
  ];

  return (
    <div className="grid gap-3">
      <Text type="supporting">
        Pilihan ini menentukan seberapa banyak langkah berikutnya terisi otomatis. Apa pun pilihannya,
        semua isi tetap bisa Anda sunting.
      </Text>

      {OPTIONS.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => choose(opt.id)}
          className={`rounded-lg border p-3 text-left transition-colors ${
            form.source === opt.id ? "border-accent bg-accent-muted" : "border-border bg-surface hover:border-strong"
          }`}
        >
          <div className="flex items-center gap-2">
            <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${form.source === opt.id ? "border-accent bg-accent" : "border-strong"}`}>
              {form.source === opt.id && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
            </span>
            <span className="text-sm font-medium">{opt.title}</span>
          </div>
          <div className="mt-1 pl-6 text-xs leading-relaxed text-secondary">{opt.body}</div>
        </button>
      ))}

      {form.source === "curriculum" && (
        <div className="grid gap-2 rounded-lg border border-border bg-muted/20 p-3">
          {!form.study_program && <Banner status="warning">Pilih program studi di langkah 1 lebih dulu.</Banner>}
          {courses.isLoading && <Text type="supporting">Memuat kurikulum…</Text>}
          {!!form.study_program && !courses.isLoading && rows.length === 0 && (
            <Banner status="info">
              Bank kurikulum {form.study_program} masih kosong. Minta Kaprodi menyusunnya di
              Admin → Kurikulum &amp; CPMK, atau pilih sumber lain.
            </Banner>
          )}
          {rows.length > 0 && (
            <>
              <Selector
                label="Mata kuliah dari kurikulum"
                value={form.source_course_id ? String(form.source_course_id) : ""}
                onChange={(v) => {
                  const course = rows.find((r) => String(r.id) === v);
                  if (course) applyCourse(course);
                }}
                options={[
                  { value: "", label: "— pilih mata kuliah —" },
                  ...rows.map((r) => ({ value: String(r.id), label: `${r.code} — ${r.name} (${r.cpmk_count} CPMK)` })),
                ]}
              />
              {applied && <Banner status="success">{applied}</Banner>}
            </>
          )}
        </div>
      )}

      {form.source === "ai" && (
        <div className="grid gap-2 rounded-lg border border-border bg-muted/20 p-3">
          {!identityReady && (
            <Banner status="warning">
              Lengkapi nama, kode, dan program studi di langkah 1 supaya AI punya konteks.
            </Banner>
          )}
          <Text type="supporting">
            AI menyusun deskripsi, bahan kajian, pustaka, CPL, CPMK, Sub-CPMK, dan rencana 16 minggu
            sekaligus. Hasilnya draf: periksa dan sunting sebelum diterbitkan.
          </Text>
          <div>
            <Button
              label={aiDraft.isPending ? "Menyusun isi RPS…" : "Susun isi RPS dengan AI"}
              variant="secondary"
              size="sm"
              isLoading={aiDraft.isPending}
              isDisabled={!identityReady || aiDraft.isPending}
              onClick={() => aiDraft.mutate()}
            />
          </div>
          {aiError !== null && <Banner status="error">{errorMessage(aiError)}</Banner>}
          {aiApplied && <Banner status="success">{aiApplied}</Banner>}
        </div>
      )}
    </div>
  );
}

function romanSemester(n: number): string {
  const roman = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
  return roman[n] ?? String(n);
}

function DescriptionStep({ form, patch }: { form: RpsFormState; patch: (n: Partial<RpsFormState>) => void }) {
  const [aiError, setAiError] = useState<unknown>(null);

  const generate = useMutation({
    mutationFn: () => api<ApiOk<{ description: string }>>("/api/description/generate", {
      method: "POST",
      body: JSON.stringify({
        course_name: form.course_name,
        course_code: form.course_code,
        semester: form.semester,
        sks_total: form.sks_theory + form.sks_practice,
      }),
    }),
    onSuccess: (res) => { setAiError(null); patch({ description: res.data.description }); },
    onError: (e: unknown) => setAiError(e),
  });

  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <Text weight="semibold">Deskripsi singkat mata kuliah</Text>
        <Text type="supporting">Tercetak pada baris Deskripsi Singkat MK di dokumen.</Text>
        <textarea
          className="min-h-[110px] w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm leading-relaxed text-primary placeholder:text-secondary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          rows={4}
          value={form.description}
          onChange={(e) => patch({ description: e.target.value })}
          placeholder="Mata kuliah ini membahas …"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            label={generate.isPending ? "Menyusun…" : "Bantu susun dengan AI"}
            variant="secondary"
            size="sm"
            isLoading={generate.isPending}
            isDisabled={form.course_name.trim().length < 2}
            onClick={() => generate.mutate()}
          />
          <Text type="supporting">{form.description.trim().length} karakter</Text>
        </div>
        {aiError !== null && <Banner status="error">{errorMessage(aiError)}</Banner>}
      </div>

      <LinesEditor label="Bahan kajian" hint="Satu topik per baris" value={form.bahan_kajian} onChange={(v) => patch({ bahan_kajian: v })} />
      <LinesEditor label="Pustaka utama" hint="Satu referensi per baris" value={form.pustaka_utama} onChange={(v) => patch({ pustaka_utama: v })} />
      <LinesEditor label="Pustaka pendukung" hint="Opsional" value={form.pustaka_pendukung} onChange={(v) => patch({ pustaka_pendukung: v })} />
    </div>
  );
}

function OutcomeStep({ form, patch }: { form: RpsFormState; patch: (n: Partial<RpsFormState>) => void }) {
  return (
    <div className="grid gap-4">
      <Text type="supporting">
        CPL adalah capaian program studi yang dibebankan pada mata kuliah ini; CPMK adalah
        turunannya, dan Sub-CPMK adalah tahapan per pertemuan.
      </Text>
      <CpTable title="CPL yang dibebankan" codeLabel="Kode CPL" rows={form.cpl} onChange={(v) => patch({ cpl: v })} defaultCode={(i) => `CPL${i + 1}`} />
      <CpTable title="CPMK" codeLabel="Kode CPMK" rows={form.cpmk} onChange={(v) => patch({ cpmk: v })} defaultCode={(i) => `CPMK ${i + 1}`} />
      <CpTable title="Sub-CPMK" codeLabel="Kode Sub-CPMK" rows={form.sub_cpmk} onChange={(v) => patch({ sub_cpmk: v })} defaultCode={(i) => `Sub-CPMK-${i + 1}`} />
    </div>
  );
}

function CpTable({
  title, codeLabel, rows, onChange, defaultCode,
}: {
  title: string;
  codeLabel: string;
  rows: CpItem[];
  onChange: (v: CpItem[]) => void;
  defaultCode: (i: number) => string;
}) {
  const set = (i: number, next: Partial<CpItem>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...next } : r)));

  return (
    <div className="grid gap-2 rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <Text weight="semibold">{title}</Text>
        <Badge variant={rows.length > 0 ? "success" : "warning"}>{rows.length} butir</Badge>
      </div>
      {rows.map((row, i) => (
        <div key={`${title}-${i}-${row.code}`} className="grid gap-2 md:grid-cols-[150px_1fr_auto] md:items-end">
          <TextInput label={codeLabel} value={row.code} onChange={(v) => set(i, { code: v })} placeholder={defaultCode(i)} />
          <TextInput
            label={`Rumusan ${row.code || defaultCode(i)}`}
            value={row.description}
            onChange={(v) => set(i, { description: v })}
            placeholder="Mampu …"
            status={row.description.trim().length > 0 && row.description.trim().length < 10 ? { type: "error", message: "Minimal 10 karakter" } : undefined}
          />
          <Button label="Hapus" variant="secondary" size="sm" onClick={() => onChange(rows.filter((_, idx) => idx !== i))} />
        </div>
      ))}
      <div>
        <Button
          label="Tambah butir"
          variant="secondary"
          size="sm"
          onClick={() => onChange([...rows, { code: defaultCode(rows.length), description: "" }])}
        />
      </div>
    </div>
  );
}

function WeeklyStep({ form, patch }: { form: RpsFormState; patch: (n: Partial<RpsFormState>) => void }) {
  const rows = form.weekly_plans;
  const total = rows.filter((r) => !r.is_merged).reduce((n, r) => n + (Number(r.weight) || 0), 0);

  const set = (i: number, next: Partial<WeeklyRow>) =>
    patch({ weekly_plans: rows.map((r, idx) => (idx === i ? { ...r, ...next } : r)) });

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Text type="supporting">
          Sembilan baris mewakili 16 pertemuan; baris ujian mengikuti struktur template dan tidak
          diberi bobot.
        </Text>
        <Badge variant={total === 100 ? "success" : "warning"}>Total bobot {total}%</Badge>
      </div>

      {rows.map((row, i) => {
        const canonical = CANONICAL_WEEKS[i];
        if (row.is_merged) {
          return (
            <div key={`week-${i}`} className="rounded-lg border border-border bg-muted px-3 py-2">
              <Text weight="semibold">Pertemuan {row.week} — {canonical?.label ?? "Ujian"}</Text>
              <Text type="supporting">Baris ujian, tanpa bobot dan tanpa isian materi.</Text>
            </div>
          );
        }
        return (
          <div key={`week-${i}`} className="grid gap-2 rounded-lg border border-border bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-2">
              <Text weight="semibold">Pertemuan {row.week}</Text>
              <div className="w-[120px]">
                <NumberField label="Bobot (%)" value={Number(row.weight) || 0} onChange={(n) => set(i, { weight: n })} max={100} />
              </div>
            </div>
            <TextInput label={`Materi pertemuan ${row.week}`} value={row.materi ?? ""} onChange={(v) => set(i, { materi: v, material: v })} placeholder="Topik yang dibahas" />
            <TextInput label={`Sub-CPMK pertemuan ${row.week}`} value={row.sub_cpmk ?? ""} onChange={(v) => set(i, { sub_cpmk: v })} placeholder="Mahasiswa mampu …" />
            <div className="grid gap-2 md:grid-cols-2">
              <TextInput label={`Indikator pertemuan ${row.week}`} value={row.indikator ?? ""} onChange={(v) => set(i, { indikator: v })} placeholder="Ketepatan dalam …" />
              <TextInput label={`Kriteria pertemuan ${row.week}`} value={row.kriteria ?? ""} onChange={(v) => set(i, { kriteria: v, assessment_criteria: v })} placeholder="Rubrik …" />
              <TextInput label={`Metode luring pertemuan ${row.week}`} value={row.luring ?? ""} onChange={(v) => set(i, { luring: v, method: v })} placeholder='TM 1×(2×50")' />
              <TextInput label={`Metode daring pertemuan ${row.week}`} value={row.daring ?? ""} onChange={(v) => set(i, { daring: v })} placeholder="Opsional" />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ReviewStep({
  form, pending, onGoTo, catalogReady, catalogIssues, catalogLabel,
}: {
  form: RpsFormState;
  pending: { id: StepId; issues: string[] }[];
  onGoTo: (id: StepId) => void;
  catalogReady: boolean;
  catalogIssues: { code: string; message: string }[];
  catalogLabel: string | null;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<unknown>(null);

  // URL objek dibebaskan saat komponen dilepas agar tidak menumpuk di memori.
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const preview = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/rps/preview", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toApiPayload(form)),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({})) as { message?: string };
        throw new Error(j.message ?? `Gagal membuat pratinjau (${r.status})`);
      }
      return r.blob();
    },
    onSuccess: (blob) => {
      setPreviewError(null);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(blob));
    },
    onError: (e: unknown) => setPreviewError(e),
  });

  const sksTotal = form.sks_theory + form.sks_practice;

  return (
    <div className="grid gap-4">
      {!catalogReady && catalogIssues.length > 0 && (
        <Banner status="error" title={`Katalog prodi belum lengkap (${catalogIssues.length})`}>
          <Text type="supporting">
            RPS tidak bisa diterbitkan sampai Kaprodi melengkapi katalog {catalogLabel ?? "prodi"} di
            Admin → Fakultas &amp; Prodi. Dosen tidak perlu menunggu — bagian lain wizard tetap bisa disunting.
          </Text>
          <ul className="mt-2 grid gap-0.5 pl-4 text-xs">
            {catalogIssues.map((it) => <li key={it.code}>{it.message}</li>)}
          </ul>
        </Banner>
      )}

      {pending.length === 0 && catalogReady ? (
        <Banner status="success" title="Semua langkah lengkap">
          Dokumen siap diterbitkan. Setelah terbit, isinya masih bisa disunting dari halaman RPS.
        </Banner>
      ) : pending.length === 0 ? null : (
        <Banner status="warning" title={`${pending.length} langkah belum lengkap`}>
          <ul className="grid gap-2">
            {pending.map((p) => (
              <li key={p.id} className="text-xs">
                <button type="button" className="text-accent underline" onClick={() => onGoTo(p.id)}>
                  {STEP_LABELS[p.id]}
                </button>
                <ul className="mt-1 grid gap-0.5 pl-4">
                  {p.issues.map((issue) => <li key={issue}>{issue}</li>)}
                </ul>
              </li>
            ))}
          </ul>
        </Banner>
      )}

      <div className="grid gap-2 rounded-lg border border-border bg-muted/20 p-3">
        <Text weight="semibold">{form.course_name || "(nama MK belum diisi)"} {form.course_code ? `(${form.course_code})` : ""}</Text>
        <Text type="supporting">
          {form.faculty || "—"} · {form.study_program || "—"} · Semester {form.semester || "—"} ·
          {" "}T{form.sks_theory}/P{form.sks_practice} ({sksTotal} SKS)
        </Text>
        <div className="mt-1 grid gap-1 text-xs text-secondary">
          <span>Dosen: {form.lecturers.filter((l) => l.name.trim()).map((l) => l.name).join(", ") || "—"}</span>
          <span>Bahan kajian {form.bahan_kajian.length} · Pustaka utama {form.pustaka_utama.length} · Pendukung {form.pustaka_pendukung.length}</span>
          <span>CPL {form.cpl.length} · CPMK {form.cpmk.length} · Sub-CPMK {form.sub_cpmk.length}</span>
        </div>
      </div>

      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            label={preview.isPending ? "Menyusun pratinjau…" : "Lihat pratinjau DOCX"}
            variant="secondary"
            size="sm"
            isLoading={preview.isPending}
            onClick={() => preview.mutate()}
          />
          {previewUrl && (
            <a className="text-sm text-accent underline" href={previewUrl} download="pratinjau-rps.docx">
              Unduh pratinjau
            </a>
          )}
        </div>
        <Text type="supporting">
          Pratinjau dibuat tanpa menyimpan apa pun, jadi Anda bisa memeriksa hasilnya lebih dulu.
        </Text>
        {previewError !== null && <Banner status="error">{errorMessage(previewError)}</Banner>}
      </div>
    </div>
  );
}
