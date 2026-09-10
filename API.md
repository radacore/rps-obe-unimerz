# API.md: RPS OBE Generator — Full Astryx + TanStack

## Authentication & Authorization

**Tidak ada autentikasi.** Semua endpoint public tanpa JWT, tanpa `Authorization` header, tanpa role guard. Cocok untuk single-tenant demo VPS pribadi. BYOK key disimpan terenkripsi di DB dan dipakai ephemeral per request via adaptor AI; tidak pernah di-log.

**TanStack Query Conventions:** Frontend memakai `@tanstack/react-query` v5. Query keys: `["api-keys"]`, `["rps"]`, `["rps", id]`, `["rps", id, "ai-generate"]`. Mutasi via `useMutation` dengan `onSuccess: qc.invalidateQueries`.

## Standard Response & Pagination Formats

**Success Response (200 OK):**
```json
{
  "success": true,
  "data": { },
  "message": "Operation completed successfully"
}
```

**Error Response (4xx/5xx):**
```json
{
  "success": false,
  "error": "validation_error",
  "message": "Human-readable description",
  "errors": { "field": ["message"] }
}
```

**Pagination Format:**
```json
{
  "success": true,
  "data": [ ],
  "pagination": {
    "current_page": 1,
    "per_page": 15,
    "total": 120,
    "last_page": 8,
    "from": 1,
    "to": 15
  }
}
```

## Health

#### Health Check
- **Method:** `GET`
- **Path:** `/api/health`
- **Description:** Check DB dan docx service (proxy).
- **Auth Level:** Public
- **Response Body:**
```json
{ "success": true, "data": { "db": "ok", "docx": "ok", "version": "2.0-simple" } }
```
- **Status Codes:** 200, 500

## Settings — API Keys (BYOK Multi-Provider)

#### List API Keys (Masked)
- **Method:** `GET`
- **Path:** `/api/settings/api-keys`
- **Description:** List key per provider tanpa plaintext. Untuk TanStack Query `["api-keys"]`.
- **Auth Level:** Public
- **Response Body:**
```json
{
  "success": true,
  "data": [
    { "provider": "openai", "keyHint": "****abcd", "isActive": true, "updatedAt": "2026-09-10T00:00:00Z" },
    { "provider": "gemini", "keyHint": "****wxyz", "isActive": true, "updatedAt": "2026-09-10T00:00:00Z" }
  ]
}
```
- **Status Codes:** 200

#### Upsert API Key
- **Method:** `PUT`
- **Path:** `/api/settings/api-keys`
- **Description:** Simpan/update key terenkripsi per provider (BYOK). Encrypt via AES-256-GCM dengan `APP_ENCRYPTION_KEY`.
- **Auth Level:** Public
- **Request Body:**
```json
{
  "provider": "openai|gemini|claude (required)",
  "apiKey": "string (required, sk-... / AIza... / sk-ant-..., min 20)"
}
```
- **Response Body:**
```json
{ "success": true, "data": { "provider": "openai", "keyHint": "****abcd", "isActive": true }, "message": "API key saved" }
```
- **Status Codes:** 200, 422 (format invalid)

#### Test API Key
- **Method:** `POST`
- **Path:** `/api/settings/api-keys/test`
- **Description:** Decrypt ephemeral dan test ke provider API. Untuk tombol Test Key di `/settings`.
- **Auth Level:** Public
- **Request Body:**
```json
{ "provider": "openai|gemini (required)" }
```
- **Response Body:**
```json
{ "success": true, "data": { "valid": true, "models": ["gpt-4o-mini", "gpt-4o"] } }
```
- **Error:** `{ "success": false, "data": { "valid": false }, "message": "Invalid API key: 401" }`
- **Status Codes:** 200, 422 (no key set), 502 (provider error)

## RPS Draft Endpoints (TanStack Query)

#### List Drafts
- **Method:** `GET`
- **Path:** `/api/rps`
- **Description:** Paginated list draft RPS. TanStack Query key `["rps", {q, page}]`.
- **Auth Level:** Public
- **Query Parameters:** `page=1`, `per_page=15`, `q=search (course_name/course_code contains)`
- **Response Body:**
```json
{
  "success": true,
  "data": [
    { "id": 1, "course_name": "Ilmu Biomedik Dasar", "course_code": "IW21ASK1541", "semester": "I", "status": "draft|generated", "updated_at": "datetime" }
  ],
  "pagination": { }
}
```
- **Status Codes:** 200

#### Create Draft
- **Method:** `POST`
- **Path:** `/api/rps`
- **Description:** Create draft baru dari field minimal (FR-01). Tanpa template_id. Canonical `course_code IW21ASK1541`, SKS `T=3 P=1 total 4`, kop Megarezky hardcode.
- **Auth Level:** Public
- **Request Body:**
```json
{
  "course_name": "string (required, e.g. Ilmu Biomedik Dasar)",
  "course_code": "string (required, canonical IW21ASK1541, cover sync R03)",
  "course_cluster": "string (optional, e.g. Keperawatan)",
  "sks_total": "integer (required, canonical 4)",
  "sks_theory": "integer (required, canonical 3)",
  "sks_practice": "integer (required, canonical 1)",
  "semester": "string (required, I-VIII + Ganjil/Genap, CONTOH I)",
  "preparation_date": "date (required, ISO, e.g. 2025-06-28)",
  "lecturers": [{ "name": "string", "nidn": "string", "role": "pengembang|koordinator_mk|ketua_prodi|anggota (require 1 koordinator_mk)" }],
  "description": "string (optional, bahan kajian singkat R23 untuk AI prompt, e.g. kelompok ilmu alam dasar... homeostasis)"
}
```
- **Response Body:**
```json
{ "success": true, "data": { "id": 1, "course_code": "IW21ASK1541", "status": "draft" }, "message": "Draft created" }
```
- **Status Codes:** 201, 422 (sks_total ≠ T+P, no Pengampu Utama)

#### Get Draft Detail
- **Method:** `GET`
- **Path:** `/api/rps/{id}`
- **Description:** Full draft dengan JSON blocks. TanStack Query `["rps", id]`.
- **Auth Level:** Public
- **Response Body:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "course_name": "Ilmu Biomedik Dasar",
    "course_code": "IW21ASK1541",
    "course_cluster": "Keperawatan",
    "sks_total": 4, "sks_theory": 3, "sks_practice": 1,
    "semester": "I",
    "preparation_date": "2025-06-28",
    "lecturers": [{ "name": "Ns. Sri Wahyuni, S.Kep.,M.Kes.", "nidn": "123", "role": "koordinator_mk" }, { "name": "Ns. Iqwan Syarif, S.Kep.,M.Kep.", "nidn": "124", "role": "ketua_prodi" }],
    "cpl": [{ "code": "CPL1", "description": "Mampu menjalankan asuhan keperawatan..." }],
    "cpmk": [{ "code": "CPMK 1", "description": "Menjelaskan konsep biolistrik...", "taxonomy": "C2" }],
    "sub_cpmk": [{ "code": "Sub-CPMK-1", "description": "Mampu menjelaskan konsep biokimia...", "taxonomy": "C3" }],
    "weekly_plans": [
      { "week": "1", "material": "Konsep Sel secara umum...", "method": "TM 1x(4x50\") + Menyesuaikan pandemic COVID-19", "experience": "Kuliah | DIskusi studi kasus", "assessment_criteria": "Rubrik presentasi (lampiran 1)", "weight": 5, "is_merged": false },
      { "week": "3, 4", "material": "Komponen kimia dalam tubuh manusia...", "method": "TM 1x(2x50\") + BM+PT (1+1)x(2x60\")", "experience": "Kuliah | Jigsaw", "assessment_criteria": "Ketapatan dalam memilih...", "weight": 10, "is_merged": false },
      { "week": "8", "material": "UJIAN MID SEMESTER", "method": "-", "experience": "-", "assessment_criteria": "-", "weight": 0, "is_merged": true },
      { "week": "9,10,11", "material": "Terminology anatomi dasar...", "method": "TM 1x(2x50\") + ...", "experience": "Kuliah | Jigsaw", "assessment_criteria": "Rubrik presentasi", "weight": 30, "is_merged": false }
    ],
    "rtm_tasks": [{ "task_no": 1, "description": "Mind Map", "duration": "4x50'", "weight": 5, "cpmk_code": "M1" }],
    "rubrics": { "observation": [{ "criterion": "string", "indicator": "string", "weight": 5 }], "assessment": [] },
    "media_methods": ["Vercel"],
    "ai_provider": "openai|null", "ai_model": "gpt-4o-mini|null",
    "status": "draft|generated",
    "file_hash": "string|null",
    "created_at": "datetime", "updated_at": "datetime"
  }
}
```
- **Status Codes:** 200, 404

#### Update Draft (Patch)
- **Method:** `PUT`
- **Path:** `/api/rps/{id}`
- **Description:** Patch draft (identity, lecturers, media, atau blocks JSON). Untuk auto-save + TanStack Mutation optimistic update. Kop universitas tidak di-patch (hardcode).
- **Auth Level:** Public
- **Request Body (partial, any subset):**
```json
{
  "course_name": "string (optional)",
  "course_code": "string (optional, canonical IW21ASK1541)",
  "course_cluster": "string (optional)",
  "sks_total": "integer (optional)",
  "sks_theory": "integer (optional)",
  "sks_practice": "integer (optional)",
  "semester": "string (optional)",
  "preparation_date": "date (optional)",
  "lecturers": [{ "name": "string", "nidn": "string", "role": "pengembang|koordinator_mk|ketua_prodi|anggota" }],
  "cpl": [], "cpmk": [], "sub_cpmk": [],
  "weekly_plans": [{ "week": "1|2|3, 4|5,6,7|8|9,10,11|12,13|14,15|16", "material": "string", "method": "string", "experience": "string", "assessment_criteria": "string", "weight": 5, "is_merged": false }],
  "rtm_tasks": [], "rubrics": {}, "media_methods": []
}
```
- **Response Body:**
```json
{ "success": true, "data": { "id": 1, "updated_at": "datetime", "weekly_plans": [], "weight_total": 100 }, "message": "Draft updated" }
```
- **Status Codes:** 200, 422 (taxonomy invalid, weight type), 404

#### Delete Draft
- **Method:** `DELETE`
- **Path:** `/api/rps/{id}`
- **Auth Level:** Public
- **Response Body:**
```json
{ "success": true, "message": "Draft deleted" }
```
- **Status Codes:** 200, 404

## AI Generation (Multi-Provider BYOK)

#### Generate Full 16 Weeks via AI
- **Method:** `POST`
- **Path:** `/api/rps/{id}/ai/generate`
- **Description:** Generate full 16 minggu + CPL/CPMK via BYOK AI provider. Decrypt key ephemeral, call adaptor, Zod validate weight=100, upsert JSON. TanStack Mutation `["rps", id, "ai-generate"]`.
- **Auth Level:** Public
- **Request Body:**
```json
{
  "provider": "openai|gemini (optional, default first active)",
  "model": "string (optional, default gpt-4o-mini for openai, gemini-1.5-flash for gemini)",
  "promptOverride": "string (optional, tambahan instruksi)"
}
```
- **Response Body:**
```json
{
  "success": true,
  "data": {
    "weekly_plans": [{ "week": 1, "material": "string", "weight": 5, "is_merged": false }],
    "cpl": [], "cpmk": [], "sub_cpmk": [], "rtm_tasks": [], "rubrics": {},
    "audit": { "passed": true, "issues": [{ "code": "TYPO_PAIAN", "severity": "warning", "message": "Found paian", "field": "weekly_plans[2].material" }] },
    "ai_provider": "openai", "ai_model": "gpt-4o-mini"
  },
  "message": "AI generated successfully"
}
```
- **Status Codes:** 200, 422 (no key set / invalid request), 502 (provider error 401/429/500), 429 (provider rate limit)

## DOCX Generation & Download

#### Generate DOCX Identical to CONTOH
- **Method:** `POST`
- **Path:** `/api/rps/{id}/generate`
- **Description:** Generate DOCX via Python docx service (FR-06). Audit critical blok jika weight≠100.
- **Auth Level:** Public
- **Rate Limit:** 20 per minute per IP (in-memory)
- **Request Body:** None
- **Response Body:**
```json
{
  "success": true,
  "data": {
    "docx_url": "/api/rps/{id}/download",
    "file_hash": "string (sha256)",
    "audit": { "passed": true, "issues": [] }
  },
  "message": "DOCX generated successfully"
}
```
- **Status Codes:** 201, 422 (audit critical weight≠100 / week≠16), 429, 502 (docx service error), 500

#### Download DOCX
- **Method:** `GET`
- **Path:** `/api/rps/{id}/download`
- **Description:** Stream DOCX local file. TanStack Query tidak cache binary.
- **Auth Level:** Public
- **Query Parameters:** `format=docx (default)`
- **Response:** Binary `Content-Disposition: attachment; filename="{kode}-{nama}-RPS.docx"`
- **Status Codes:** 200, 404, 410 (expired jika file hilang)

#### Audit Draft (Standalone)
- **Method:** `POST`
- **Path:** `/api/rps/{id}/audit`
- **Description:** Jalankan audit tanpa generate. Untuk TanStack Query `["rps", id, "audit"]` poll.
- **Auth Level:** Public
- **Response Body:**
```json
{
  "success": true,
  "data": {
    "passed": false,
    "issues": [
      { "code": "WEIGHT_MISMATCH", "severity": "critical", "message": "Weekly weight sum is 95, expected 100", "field": "weekly_plans" },
      { "code": "TYPO_PAIAN", "severity": "warning", "message": "Found paian should be capaian", "field": "cpmk[2].description" }
    ]
  }
}
```
- **Status Codes:** 200, 404

## Error Handling & Status Codes

| Code | Meaning | Example |
|:---|:---|:---|
| 200 | OK | GET/PUT success |
| 201 | Created | POST create/generate |
| 400 | Bad Request | Malformed JSON |
| 404 | Not Found | Draft/provider not found |
| 410 | Gone | File expired (storage hilang) |
| 422 | Unprocessable | Validation / audit critical / no key set |
| 429 | Too Many Requests | Rate limit provider atau generate |
| 500 | Server Error | Docx service / DB failure |
| 502 | Bad Gateway | AI provider error (401 key invalid, 429, 500) |

**Document Version:** 2.0-simple
**Last Updated:** 2026-09-10
**Status:** Ready for Development (Full Astryx + TanStack)
