import { Hono } from "hono";
import { cors } from "hono/cors";
import { Buffer } from "node:buffer";
import { prisma } from "./src/lib/db";
import { encrypt, decrypt, keyHint } from "./src/lib/crypto";
import { rpsCreateSchema } from "./src/lib/zod";
import { auditDraft } from "./src/lib/audit";

const app = new Hono();
app.use("/*", cors());

app.get("/api/health", async (c) => {
  try { await prisma.$queryRaw`SELECT 1`; return c.json({ success: true, data: { db: "ok", version: "2.0-simple" } }); }
  catch (e) { return c.json({ success: false, error: "db_error" }, 500); }
});

// Settings
app.get("/api/settings/api-keys", async (c) => {
  const rows = await prisma.apiKey.findMany({ orderBy: { provider: "asc" } });
  return c.json({ success: true, data: rows.map((r) => ({ provider: r.provider, keyHint: r.keyHint, isActive: r.isActive, updatedAt: r.updatedAt })) });
});

app.put("/api/settings/api-keys", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { provider, apiKey } = body as { provider?: string; apiKey?: string };
  if (!provider || !apiKey) return c.json({ success: false, error: "validation_error", message: "provider & apiKey required" }, 422);
  if (!["openai", "gemini", "claude"].includes(provider)) return c.json({ success: false, message: "provider invalid" }, 422);
  // format check — gemini longgarkan: terima AIza... maupun AQ.../Vertex & key panjang >=20 (tidak hard-require AIza)
  if (provider === "openai" && !/^sk-/.test(apiKey)) return c.json({ success: false, message: "Format key OpenAI harus sk-..." }, 422);
  if (provider === "gemini" && apiKey.trim().length < 20) return c.json({ success: false, message: "API key Gemini terlalu pendek (min 20 char)" }, 422);
  if (provider === "claude" && !/^sk-ant-/.test(apiKey)) return c.json({ success: false, message: "Format key Claude harus sk-ant-..." }, 422);
  const encrypted = encrypt(apiKey);
  const hint = keyHint(apiKey);
  const row = await prisma.apiKey.upsert({ where: { provider }, create: { provider, encryptedKey: encrypted, keyHint: hint }, update: { encryptedKey: encrypted, keyHint: hint, isActive: true } });
  return c.json({ success: true, data: { provider: row.provider, keyHint: row.keyHint, isActive: row.isActive }, message: "API key saved" });
});

app.post("/api/settings/api-keys/test", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { provider } = body as { provider?: string };
  if (!provider) return c.json({ success: false, message: "provider required" }, 422);
  const row = await prisma.apiKey.findUnique({ where: { provider } });
  if (!row) return c.json({ success: false, message: "No key set" }, 422);
  let key: string;
  try { key = decrypt(row.encryptedKey); } catch (e) { return c.json({ success: false, message: "Decrypt failed" }, 500); }
  try {
    if (provider === "openai") {
      const r = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${key}` } });
      if (!r.ok) return c.json({ success: true, data: { valid: false }, message: `Invalid key: ${r.status}` });
      const j = await r.json() as { data: { id: string }[] };
      return c.json({ success: true, data: { valid: true, models: j.data?.slice(0, 20).map((m) => m.id) ?? [] } });
    } else if (provider === "gemini") {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`);
      if (!r.ok) return c.json({ success: true, data: { valid: false }, message: `Invalid key: ${r.status}` });
      const j = await r.json() as { models: { name: string }[] };
      return c.json({ success: true, data: { valid: true, models: (j.models ?? []).map((m) => m.name.split("/").pop()!) } });
    } else {
      return c.json({ success: true, data: { valid: true, models: [] } });
    }
  } catch (e) {
    return c.json({ success: false, message: "Provider error", error: String(e) }, 502);
  }
});

// RPS CRUD
app.get("/api/rps", async (c) => {
  const q = c.req.query("q") ?? "";
  const page = Math.max(1, Number(c.req.query("page") ?? "1"));
  const per_page = Math.min(50, Math.max(1, Number(c.req.query("per_page") ?? "15")));
  const where = q ? { OR: [{ courseName: { contains: q } }, { courseCode: { contains: q } }] } : {};
  const [total, rows] = await Promise.all([
    prisma.rpsDraft.count({ where }),
    prisma.rpsDraft.findMany({ where, orderBy: { updatedAt: "desc" }, skip: (page - 1) * per_page, take: per_page }),
  ]);
  const data = rows.map((r) => ({ id: r.id, course_name: r.courseName, course_code: r.courseCode, semester: r.semester, status: r.status, updated_at: r.updatedAt }));
  return c.json({ success: true, data, pagination: { current_page: page, per_page, total, last_page: Math.ceil(total / per_page), from: (page - 1) * per_page + 1, to: Math.min(page * per_page, total) } });
});

app.post("/api/rps", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = rpsCreateSchema.safeParse(body);
  if (!parsed.success) return c.json({ success: false, error: "validation_error", message: "Validation failed", errors: parsed.error.flatten().fieldErrors }, 422);
  const d = parsed.data;
  const row = await prisma.rpsDraft.create({
    data: {
      courseName: d.course_name, courseCode: d.course_code, courseCluster: d.course_cluster ?? null,
      sksTotal: d.sks_total, sksTheory: d.sks_theory, sksPractice: d.sks_practice,
      semester: d.semester, preparationDate: new Date(d.preparation_date),
      lecturers: JSON.stringify(d.lecturers), cpl: JSON.stringify([]), cpmk: JSON.stringify([]), subCpmk: JSON.stringify([]),
      weeklyPlans: JSON.stringify([]), mediaMethods: JSON.stringify([]), status: "draft",
    },
  });
  return c.json({ success: true, data: { id: row.id, course_code: row.courseCode, status: row.status }, message: "Draft created" }, 201);
});

app.get("/api/rps/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const r = await prisma.rpsDraft.findUnique({ where: { id } });
  if (!r) return c.json({ success: false, message: "Not found" }, 404);
  const parse = (s: string | null) => { try { return s ? JSON.parse(s) : []; } catch { return []; } };
  return c.json({ success: true, data: {
    id: r.id, course_name: r.courseName, course_code: r.courseCode, course_cluster: r.courseCluster,
    sks_total: r.sksTotal, sks_theory: r.sksTheory, sks_practice: r.sksPractice, semester: r.semester,
    preparation_date: r.preparationDate, lecturers: parse(r.lecturers), cpl: parse(r.cpl), cpmk: parse(r.cpmk), sub_cpmk: parse(r.subCpmk),
    weekly_plans: parse(r.weeklyPlans), rtm_tasks: r.rtmTasks ? parse(r.rtmTasks) : [], rubrics: r.rubrics ? parse(r.rubrics) : { observation: [], assessment: [] },
    media_methods: parse(r.mediaMethods), ai_provider: r.aiProvider, ai_model: r.aiModel, status: r.status, file_hash: r.fileHash, created_at: r.createdAt, updated_at: r.updatedAt,
  }});
});

app.put("/api/rps/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const r = await prisma.rpsDraft.findUnique({ where: { id } });
  if (!r) return c.json({ success: false, message: "Not found" }, 404);
  const patch: Record<string, unknown> = {};
  if (body.course_name) patch.courseName = body.course_name as string;
  if (body.course_code) patch.courseCode = body.course_code as string;
  if (body.course_cluster !== undefined) patch.courseCluster = body.course_cluster as string;
  if (body.sks_total) patch.sksTotal = body.sks_total as number;
  if (body.sks_theory !== undefined) patch.sksTheory = body.sks_theory as number;
  if (body.sks_practice !== undefined) patch.sksPractice = body.sks_practice as number;
  if (body.semester) patch.semester = body.semester as string;
  if (body.preparation_date) patch.preparationDate = new Date(body.preparation_date as string);
  if (body.lecturers) patch.lecturers = JSON.stringify(body.lecturers);
  if (body.cpl) patch.cpl = JSON.stringify(body.cpl);
  if (body.cpmk) patch.cpmk = JSON.stringify(body.cpmk);
  if (body.sub_cpmk) patch.subCpmk = JSON.stringify(body.sub_cpmk);
  if (body.weekly_plans) patch.weeklyPlans = JSON.stringify(body.weekly_plans);
  if (body.rtm_tasks) patch.rtmTasks = JSON.stringify(body.rtm_tasks);
  if (body.rubrics) patch.rubrics = JSON.stringify(body.rubrics);
  if (body.media_methods) patch.mediaMethods = JSON.stringify(body.media_methods);
  const updated = await prisma.rpsDraft.update({ where: { id }, data: patch as never });
  const plans = (()=>{ try{ return JSON.parse(updated.weeklyPlans as string);}catch{ return []; }})();
  const weight_total = (plans as {weight:number}[]).reduce((s,p)=>s+(p.weight??0),0);
  return c.json({ success: true, data: { id: updated.id, updated_at: updated.updatedAt, weekly_plans: plans, weight_total }, message: "Draft updated" });
});

app.delete("/api/rps/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const r = await prisma.rpsDraft.findUnique({ where: { id } });
  if (!r) return c.json({ success: false, message: "Not found" }, 404);
  await prisma.rpsDraft.delete({ where: { id } });
  return c.json({ success: true, message: "Draft deleted" });
});

// AI adaptor stubs + audit
app.post("/api/rps/:id/ai/generate", async (c) => {
  const id = Number(c.req.param("id"));
  const draft = await prisma.rpsDraft.findUnique({ where: { id } });
  if (!draft) return c.json({ success: false, message: "Not found" }, 404);
  const body = await c.req.json().catch(()=>({})) as { provider?: string; model?: string; promptOverride?: string };
  let provider = body.provider as string | undefined;
  if (!provider) {
    const anyKey = await prisma.apiKey.findFirst({ where: { isActive: true } });
    provider = anyKey?.provider;
  }
  if (!provider) return c.json({ success: false, message: "No API key set. Buka /settings." }, 422);
  const keyRow = await prisma.apiKey.findUnique({ where: { provider } });
  if (!keyRow) return c.json({ success: false, message: `No key for ${provider}` }, 422);
  let apiKey: string; try { apiKey = decrypt(keyRow.encryptedKey); } catch { return c.json({ success: false, message: "Decrypt failed" }, 500); }
  const model = body.model ?? (provider === "openai" ? "gpt-4o-mini" : provider === "gemini" ? "gemini-1.5-flash" : "claude-3-haiku");
  // Prompt canonical — 1:1 template 8 kolom (tc1-7) untuk fidelity DOCX
  const prompt = `Kamu generator RPS OBE. Course: ${draft.courseName} (${draft.courseCode}), SKS ${draft.sksTheory}/${draft.sksPractice}, semester ${draft.semester}. 
Output JSON ketat tanpa markdown: {"cpl":[{"code":"...","description":"..."}], "cpmk":[{"code":"CPMK 1","description":"...","taxonomy":"C2","cpl_code":"CPL1"}], "sub_cpmk":[{"code":"Sub-CPMK-1","description":"...","taxonomy":"C3","cpmk_code":"CPMK 1"}], "weeklyPlans":[{"week":"1","material":"...","method":"TM 1×(4×50\\")","experience":"Kuliah | Diskusi","assessment_criteria":"Rubrik","sub_cpmk":"Mahasiswa mampu menjelaskan tentang ...","indikator":"Ketepatan dalam menjelaskan ... | Keaktifan dalam diskusi","kriteria":"Rubrik penilaian presentasi kelompok (lampiran 1) | ...","daring":"Menyesuaikan perkembangan pandemic COVID-19","luring":"TM 1×(4×50\\") | Kuliah | Diskusi","materi":"Materi pembelajaran ringkas","weight":5,"is_merged":false}], "rtmTasks":[{"task_no":1,"description":"Mind Map","duration":"4x50'","weight":5,"cpmk_code":"M1"}], "rubrics":{"observation":[],"assessment":[]}}
Aturan: 9 baris weeklyPlans mewakili 16 minggu: R35 1:5, R36 2:5, R37 3,4:10, R38 5,6,7:20, R39 8:UTS merge is_merged true label UJIAN MID SEMESTER weight 0, R40 9,10,11:30, R41 12,13:10, R42 14,15:20, R43 16:UAS merge is_merged true label UJIAN FINAL SEMESTER weight 0. Sum non-merge 100. 
Setiap weeklyPlans WAJIB isi 8 kolom template 1:1: sub_cpmk (tc1 Sub-CPMK, contoh "Mahasiswa mampu menjelaskan tentang ..."), indikator (tc2 Ketepatan...|Keaktifan...), kriteria (tc3 Kriteria & Bentuk / rubrik), daring (tc4 Daring), luring (tc5 Luring metode + [TM 1x(...) ]), materi (tc6 Materi Pembelajaran), plus week (tc0), weight (tc7). Untuk UTS/UAS hanya week + is_merged true + material label ujian.
Compat: field legacy material/method/experience/assessment_criteria tetap isi; field baru sub_cpmk/indikator/kriteria/daring/luring/materi adalah verbatim untuk DOCX — jangan duplikat antar kolom.
CPL 2, CPMK 4, Sub-CPMK 7 taxonomy A2/P3/C2/C3/C4, hook Menyesuaikan perkembangan pandemic COVID-19, Daring/Luring split, kop Universitas Megarezky.
${body.promptOverride ?? ""}`;

  type WeeklyGen = { week: string; material: string; method: string; experience: string; assessment_criteria: string; weight: number; is_merged: boolean; sub_cpmk?: string; indikator?: string; kriteria?: string; daring?: string; luring?: string; materi?: string };
  type Gen = { cpl: unknown[]; cpmk: unknown[]; sub_cpmk: unknown[]; weeklyPlans: WeeklyGen[]; rtmTasks: unknown[]; rubrics: unknown };
  let gen: Gen | null = null;
  try {
    if (provider === "openai") {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: [{ role: "system", content: "You are RPS OBE generator. Output JSON only." }, { role: "user", content: prompt }], response_format: { type: "json_object" }, temperature: 0.4 }),
      });
      if (!r.ok) { const t = await r.text(); return c.json({ success: false, message: `Provider error ${r.status}`, error: t }, 502); }
      const j = await r.json() as { choices: { message: { content: string } }[] };
      gen = JSON.parse(j.choices[0].message.content);
    } else if (provider === "gemini") {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.4 } }),
      });
      if (!r.ok) { const t = await r.text(); return c.json({ success: false, message: `Provider error ${r.status}`, error: t }, 502); }
      const j = await r.json() as { candidates: { content: { parts: { text: string }[] } }[] };
      gen = JSON.parse(j.candidates[0].content.parts[0].text);
    } else {
      return c.json({ success: false, message: "Claude adaptor belum tersedia" }, 502);
    }
  } catch (e) {
    return c.json({ success: false, message: "AI generate failed", error: String(e) }, 502);
  }
  if (!gen || !Array.isArray(gen.weeklyPlans)) return c.json({ success: false, message: "AI output invalid" }, 502);
  // Zod-ish validate weight
  const sum = gen.weeklyPlans.filter((p) => !p.is_merged).reduce((s, p) => s + p.weight, 0);
  if (sum !== 100) {
    // retry 1x via model? for now return 422 with audit
    const audit = auditDraft({ weeklyPlans: JSON.stringify(gen.weeklyPlans) });
    return c.json({ success: false, message: `Weight sum ${sum} ≠ 100, retry`, audit, data: gen }, 422);
  }
  const audit = auditDraft({ weeklyPlans: JSON.stringify(gen.weeklyPlans) });
  await prisma.rpsDraft.update({ where: { id }, data: {
    cpl: JSON.stringify(gen.cpl ?? []), cpmk: JSON.stringify(gen.cpmk ?? []), subCpmk: JSON.stringify(gen.sub_cpmk ?? []),
    weeklyPlans: JSON.stringify(gen.weeklyPlans), rtmTasks: JSON.stringify(gen.rtmTasks ?? []), rubrics: JSON.stringify(gen.rubrics ?? {}),
    aiProvider: provider, aiModel: model,
  }});
  return c.json({ success: true, data: { ...gen, audit, ai_provider: provider, ai_model: model }, message: "AI generated successfully" });
});

app.post("/api/rps/:id/generate", async (c) => {
  const id = Number(c.req.param("id"));
  const draft = await prisma.rpsDraft.findUnique({ where: { id } });
  if (!draft) return c.json({ success: false, message: "Not found" }, 404);
  const plans = (()=>{ try{ return JSON.parse(draft.weeklyPlans as string);}catch{ return []; }})();
  const audit = auditDraft({ weeklyPlans: draft.weeklyPlans as string });
  if (!audit.passed) return c.json({ success: false, message: "Audit critical, perbaiki dulu", audit }, 422);
  // Call Python docx service if available, else JS fallback
  const docxUrl = process.env.DOCX_SERVICE_URL ?? "http://localhost:8001";
  try {
    const payload = {
      rps_draft: {
        id: draft.id, course_name: draft.courseName, course_code: draft.courseCode, course_cluster: draft.courseCluster,
        sks_total: draft.sksTotal, sks_theory: draft.sksTheory, sks_practice: draft.sksPractice, semester: draft.semester,
        preparation_date: draft.preparationDate, lecturers: JSON.parse(draft.lecturers as string),
        cpl: JSON.parse(draft.cpl as string), cpmk: JSON.parse(draft.cpmk as string), sub_cpmk: JSON.parse(draft.subCpmk as string),
        weekly_plans: plans, rtm_tasks: draft.rtmTasks ? JSON.parse(draft.rtmTasks as string) : [], rubrics: draft.rubrics ? JSON.parse(draft.rubrics as string) : {},
        kop: "Universitas Megarezky | Fakultas Keperawatan dan Kebidanan | Program Studi S1 Keperawatan dan Pendidikan Profesi Ners",
      }
    };
    const r = await fetch(`${docxUrl.replace(/\/$/, "")}/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (r.ok) {
      const buf = Buffer.from(await r.arrayBuffer());
      const { createHash } = await import("node:crypto");
      const fileHash = createHash("sha256").update(buf).digest("hex");
      const dir = `storage/files/${id}`;
      const { mkdir, writeFile } = await import("node:fs/promises");
      await mkdir(dir, { recursive: true });
      await writeFile(`${dir}/${fileHash}.docx`, buf);
      await prisma.rpsDraft.update({ where: { id }, data: { fileHash, storagePath: `${dir}/${fileHash}.docx`, status: "generated" } });
      return c.json({ success: true, data: { docx_url: `/api/rps/${id}/download`, file_hash: fileHash, audit }, message: "DOCX generated successfully" }, 201);
    }
    const errText = await r.text().catch(()=> "");
    throw new Error(`docx service ${r.status}: ${errText.slice(0,200)}`);
  } catch (e) {
    // Fallback: build DOCX via JS (docx lib) so download always works even tanpa Python service
    try {
      const { buildDocxBuffer } = await import("./src/lib/docx.ts");
      const lecturers = (()=>{ try{ return JSON.parse(draft.lecturers as string);}catch{return []}})() as { name:string; role:string; nidn:string }[];
      const buf = await buildDocxBuffer({
        course_name: draft.courseName, course_code: draft.courseCode, course_cluster: draft.courseCluster,
        sks_total: draft.sksTotal, sks_theory: draft.sksTheory, sks_practice: draft.sksPractice,
        semester: draft.semester, preparation_date: String(draft.preparationDate), lecturers, weekly_plans: plans as never,
      });
      const { createHash } = await import("node:crypto");
      const fileHash = createHash("sha256").update(buf).digest("hex");
      const dir = `storage/files/${id}`;
      const { mkdir, writeFile } = await import("node:fs/promises");
      await mkdir(dir, { recursive: true });
      await writeFile(`${dir}/${fileHash}.docx`, buf);
      await prisma.rpsDraft.update({ where: { id }, data: { fileHash, storagePath: `${dir}/${fileHash}.docx`, status: "generated" } });
      return c.json({ success: true, data: { docx_url: `/api/rps/${id}/download`, file_hash: fileHash, audit, note: `JS fallback after: ${String(e).slice(0,120)}` }, message: "DOCX generated (JS fallback)" }, 201);
    } catch (e2) {
      const { createHash } = await import("node:crypto");
      const fileHash = createHash("sha256").update(JSON.stringify(plans)).digest("hex").slice(0, 16);
      await prisma.rpsDraft.update({ where: { id }, data: { fileHash, status: "generated" } });
      return c.json({ success: true, data: { docx_url: `/api/rps/${id}/download`, file_hash: fileHash, audit, warning: String(e) + " | fallback: " + String(e2) }, message: "DOCX stub (docx service not running)" }, 201);
    }
  }
});

app.get("/api/rps/:id/download", async (c) => {
  const id = Number(c.req.param("id"));
  const draft = await prisma.rpsDraft.findUnique({ where: { id } });
  if (!draft) return c.json({ success: false, message: "Not found" }, 404);
  // If status generated but storagePath not yet set (old stub rows), rebuild via JS fallback on-the-fly
  if (!draft.storagePath) {
    if (draft.status !== "generated") return c.json({ success: false, message: "Belum generate DOCX" }, 404);
    // on-the-fly rebuild so download always works
    try {
      const { buildDocxBuffer } = await import("./src/lib/docx.ts");
      const plans = (()=>{ try{ return JSON.parse(draft.weeklyPlans as string);}catch{return []}})() as never;
      const lecturers = (()=>{ try{ return JSON.parse(draft.lecturers as string);}catch{return []}})() as { name:string; role:string; nidn:string }[];
      const buf = await buildDocxBuffer({
        course_name: draft.courseName, course_code: draft.courseCode, course_cluster: draft.courseCluster,
        sks_total: draft.sksTotal, sks_theory: draft.sksTheory, sks_practice: draft.sksPractice,
        semester: draft.semester, preparation_date: String(draft.preparationDate), lecturers, weekly_plans: plans,
      });
      c.header("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      c.header("Content-Disposition", `attachment; filename="${draft.courseCode}-${draft.courseName}-RPS.docx"`);
      return c.body(buf as never);
    } catch {
      return c.json({ success: false, message: "Belum generate DOCX (storagePath kosong dan fallback gagal)" }, 404);
    }
  }
  try {
    const file = Bun.file(draft.storagePath);
    if (!(await file.exists())) {
      // storagePath points to missing file (e.g. after reset) — fallback rebuild instead of 410 so UX tetap download
      try {
        const { buildDocxBuffer } = await import("./src/lib/docx.ts");
        const plans = (()=>{ try{ return JSON.parse(draft.weeklyPlans as string);}catch{return []}})() as never;
        const lecturers = (()=>{ try{ return JSON.parse(draft.lecturers as string);}catch{return []}})() as { name:string; role:string; nidn:string }[];
        const buf = await buildDocxBuffer({
          course_name: draft.courseName, course_code: draft.courseCode, course_cluster: draft.courseCluster,
          sks_total: draft.sksTotal, sks_theory: draft.sksTheory, sks_practice: draft.sksPractice,
          semester: draft.semester, preparation_date: String(draft.preparationDate), lecturers, weekly_plans: plans,
        });
        c.header("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        c.header("Content-Disposition", `attachment; filename="${draft.courseCode}-${draft.courseName}-RPS.docx"`);
        return c.body(buf as never);
      } catch {
        return c.json({ success: false, message: "File hilang, generate ulang" }, 410);
      }
    }
    const buf = await file.arrayBuffer();
    c.header("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    c.header("Content-Disposition", `attachment; filename="${draft.courseCode}-${draft.courseName}-RPS.docx"`);
    return c.body(buf as never);
  } catch {
    return c.json({ success: false, message: "File hilang" }, 410);
  }
});

app.post("/api/rps/:id/audit", async (c) => {
  const id = Number(c.req.param("id"));
  const draft = await prisma.rpsDraft.findUnique({ where: { id } });
  if (!draft) return c.json({ success: false, message: "Not found" }, 404);
  const result = auditDraft({ weeklyPlans: draft.weeklyPlans as string });
  return c.json({ success: true, data: result });
});

export default {
  port: Number(process.env.PORT ?? 3001),
  fetch: app.fetch,
};
