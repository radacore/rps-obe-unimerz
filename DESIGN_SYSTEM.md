# DESIGN_SYSTEM.md: RPS OBE Generator — Full Astryx + TanStack

## Brand & Visual Identity

RPS OBE Generator Simple adalah tool single-page tanpa login yang memproyeksikan **ringkas, terpercaya, akademik**. Identitas visual tetap akademik (navy/putih/accent teal) tetapi layout disederhanakan via **Full Astryx Design System** (`astryx.atmeta.com`): `AppShell` + `TopNav` header minimal, `Stepper` 3 langkah, dan **Astryx `Table` (wrapper TanStack Table v8)** untuk 9 rows/16 minggu sebagai hero. Whitespace lega, border hairline `single 4` analog di UI, dan `Badge`/`Banner`/`ProgressBar` Astryx sebagai feedback utama. StyleX + Tailwind v4 bridging menjamin token konsisten tanpa vendor UI berat.

Tone: praktis-skripsi — user paham dalam 30 detik: isi → generate AI → download.

## Install & Theme Setup — Full Astryx (Wajib)

> Spec ini adalah **Full Astryx** — bukan hybrid Tailwind manual. Semua komponen UI wajib pakai `@astryxdesign/core`. Tidak ada housing Tailwind v3 lama.

### 1. Dependencies

```bash
bun add @astryxdesign/core @stylexjs/stylex @astryxdesign/theme-neutral @astryxdesign/cli @tanstack/react-start @tanstack/react-router @tanstack/react-query @tanstack/react-table
# Vite + TanStack Start (tanstack.com) + React 19 wajib (Astryx React 19 only)
# Tailwind v4 via bridging (bukan v3); tanpa Next.js
```

### 2. Init Astryx

```bash
bunx astryx init --all
# scaffolds:
# - src/styles/globals.css dengan layer order
# - src/styles/tailwind-theme.css (Tailwind v4 @theme bridge)
# - src/lib/theme.ts (defineTheme)
# - stylex config (hanya compile jika swizzle/xstyle dipakai)
```

### 3. Theme — `lib/theme.ts` (Academic Navy via `defineTheme`)

```ts
import { defineTheme } from "@astryxdesign/core";
import { neutralTheme } from "@astryxdesign/theme-neutral";

export const theme = defineTheme({
  extends: neutralTheme,
  color: {
    // Academic Navy — accent override
    accent: ["#1E3A5F", "#234876"], // 0: primary, 1: hover/dark
    // Semantic mapping via token override
    success: ["#15803D"],
    error: ["#DC2626"],
    warning: ["#D97706"],
  },
  typography: {
    fontFamily: {
      sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
      mono: ["JetBrains Mono", "Courier New", "monospace"],
    },
  },
  // Astryx spacing/radius tokens dipakai langsung; tidak perlu Tailwind extend manual
});
```

`AppShell` provider di `src/routes/__root.tsx` (TanStack Router):

```tsx
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { AstryxProvider } from "@astryxdesign/core";
import { theme } from "@/lib/theme";
import "@/styles/globals.css";
import "@/styles/tailwind-theme.css";

export const Route = createRootRoute({
  component: () => (
    <AstryxProvider theme={theme}>
      <Outlet />
    </AstryxProvider>
  ),
});
```

### 4. CSS Layer Order — `src/styles/globals.css`

```css
/* Astryx full — layer order wajib */
@layer reset, theme, base, astryx-base, astryx-theme, components, utilities;

@import "tailwindcss" layer(utilities);
@import "./tailwind-theme.css" layer(theme);

/* Google Fonts via @import di layer base (tanpa next/font) */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
```

### 5. Tailwind v4 Bridge — `src/styles/tailwind-theme.css`

```css
/* Bridging Astryx tokens ke Tailwind v4 @theme — auto-generated oleh `astryx init` */
@theme {
  --color-primary: var(--astryx-color-accent-0); /* #1E3A5F */
  --color-primary-dark: var(--astryx-color-accent-1); /* #234876 */
  --color-accent: var(--astryx-color-accent-0);
  --color-success: var(--astryx-color-success-0);
  --color-error: var(--astryx-color-error-0);
  --color-warning: var(--astryx-color-warning-0);
  /* spacing/radius diwarisi dari Astryx tokens */
}
```

> **StyleX compiler:** hanya aktif jika menjalankan `astryx swizzle` atau `xstyle`. Jika tidak, Astryx berjalan via Tailwind bridge tanpa compile step tambahan.

## User Experience Goals

1. **Zero-Friction Input** — Dari buka URL ke draft tersimpan dengan 8 field < 5 min, tanpa login, tanpa modal auth. Form via Astryx `Field` + `TextInput`/`TextArea`/`Selector`/`NumberInput`/`DateInput` di `Grid`.
2. **Astryx Table Confidence** — Tabel 9 rows/16 minggu editable via **Astryx `Table` (TanStack wrapper)** dengan live `Σ = 100` (`Badge` + `ProgressBar`) hijau/merah < 100ms, row UTS/UAS merged lock jelas, `Banner` audit typo visible inline.
3. **BYOK Transparency** — `Card` API Key mask `****abcd` + `Badge` Valid/Invalid + `Selector` model; user paham key terenkripsi dan tidak pernah terlihat lagi. `Dialog`/`Toast` untuk feedback.

## Color Palette — Via Astryx `defineTheme` Tokens

Palet didefinisikan di `defineTheme`, bukan `tailwind.config.js` manual. `tailwind-theme.css` bridge otomatis expose ke Tailwind v4.

| Token | Hex | Astryx Token | Usage |
|:---|:---|:---|:---|
| Academic Navy | `#1E3A5F` | `--astryx-color-accent-0` | Header `TopNav`, primary button Generate, `Stepper` active |
| Ink Slate | `#234876` | `--astryx-color-accent-1` | Header bar, hover, footer |
| Teal Accent | `#0F766E` | `--astryx-color-accent` alt | Focus ring, Valid badge |
| Paper Blue | `#E0ECF5` | `--astryx-color-secondary-light` | `Table` header, info `Banner` BYOK |
| Warm Gray | `#F1F5F9` | `--astryx-color-neutral-light` | `Card` fill, `Stepper` track |
| Success Green | `#15803D` | `--astryx-color-success-0` | Weight = 100, `Badge variant:success`, `Banner status:success` |
| Error Red | `#DC2626` | `--astryx-color-error-0` | Weight ≠100, Invalid key, `Banner status:error` |
| Warning Amber | `#D97706` | `--astryx-color-warning-0` | Typo warning, `Banner status:warning` |
| Text Dark | `#1E293B` | `--astryx-color-text-primary` | Body, `Table` content |
| Text Medium | `#64748B` | `--astryx-color-text-secondary` | Helper, week label |
| Border Gray | `#E2E8F0` | `--astryx-color-border` | Input border, table grid |

Tidak ada `tailwind.config.js` `theme.extend.colors` manual — semua via `defineTheme` + `@theme` bridge.

## Typography — Via Astryx Theme

| Element | Size | Weight | Astryx Token / Component |
|:---|:---|:---|:---|
| H1 | 32px / 2rem | 700 | `theme.typography.h1` — Page title "RPS OBE Generator" |
| H2 | 22px / 1.375rem | 700 | `theme.typography.h2` — `Stepper` step title |
| H3 | 16px / 1rem | 600 | `theme.typography.h3` — `Card` header |
| Body Regular | 14px | 400 | `Field`/`TextInput` default |
| Body Small | 13px | 400 | `Badge`, metadata |
| Caption | 11px | 500 | Audit code, `w:sectPr` ref |
| Code | 13px | 500 | `file_hash`, `sz=18` (`mono` family) |

Font di-set via `defineTheme typography.fontFamily`; Vite `@fontsource/inter` alternatif untuk optimasi.

## UI Components — Full Astryx Mapping (Wajib)

Semua komponen di bawah adalah dari `@astryxdesign/core`. Tidak ada shadcn/manual `<button>`.

| Area | Astryx Component | Props Penting | Catatan |
|:---|:---|:---|:---|
| **Shell** | `AppShell` + `TopNav` | `AppShell` wrap layout, `TopNav` logo + nav `/` + `/settings` | Ganti header manual `div` |
| **Stepper** | `Stepper` + `Step` | `activeStep`, `onStepChange`, `role="tablist"` built-in | 3 langkah: Identitas → Deskripsi → AI Generate + Review |
| **Form** | `Field` + `FieldLabel` + `TextInput` + `TextArea` + `Selector` + `NumberInput` + `DateInput` + `Grid` | `Field` error/hint, `Selector` options, `Grid cols` | 8 field identitas; `sks_total = sks_theory + sks_practice` via `NumberInput` + Zod |
| **Table** | `Table` (wraps TanStack Table v8) | `data`, `columns`, `getCoreRowModel` | **Wajib**: `useReactTable` di bawah via Astryx `Table`; 9 rows variabel; cell editor `TextInput`/`Selector` via `meta.updateData`; `Badge` di week col |
| **Feedback** | `Banner` + `Badge` + `ProgressBar` | `Banner status:error/warning/info`, `Badge variant:success/danger/warning`, `ProgressBar value={weight_total}` | Audit panel critical/warning; live `Σ = 100` hijau/merah + shake |
| **Lists** | `Card` + `ClickableCard` + `Pagination` + `EmptyState` | `Card` header, `ClickableCard onClick`, `Pagination page/total` | Draft list `/` + `/settings` provider cards |
| **Overlay** | `Dialog` + `Toast` | `Dialog open/onClose`, `Toast variant` | Test Key result, Generate DOCX confirm, error actionable |
| **Preview** | `Card` + `Badge` | orientation portrait/landscape badge | HTML preview tabel (bukan PDF wajib) |

**Larangan:** Jangan buat `<input>`, `<select>`, `<table>` manual untuk area di atas — selalu pakai komponen Astryx.

## Screen Priorities — Full Astryx

### Single-Page Priority Order

1. **`AppShell` + `TopNav`** — Logo "RPS OBE" + nav `/` (Drafts) + `/settings` (API Keys) + status `Badge` DB healthy. Tanpa avatar/login.
2. **Draft List (`/`)** — `Field` search `q`, `Pagination` 15, `Card`/`ClickableCard` per draft (kode, nama, semester, updated_at) + actions: Lanjutkan Edit / Hapus / Download. `EmptyState` CTA "Buat RPS Baru".
3. **`Stepper` 3 Langkah (`/rps/$id`)** — Step 1 Identitas (Astryx `Field`/`TextInput`/`Selector`/`NumberInput`/`DateInput` dalam `Grid`), Step 2 Deskripsi MK `TextArea`, Step 3 AI Generate (`Selector` provider/model + Generate button + loading). `ProgressBar` 3 dots, Next/Back via Astryx `Button`. Route `src/routes/rps.$id.tsx` (TanStack Router).
4. **Astryx `Table` 9 Rows / 16 Minggu (Review)** — `Table` + `useReactTable` 9 rows, inline edit via `TextInput` cell, `Badge`/`ProgressBar` footer `Σ`, merged UTS/UAS lock, `Banner` audit panel critical/warning dengan Fix links. Highest interaction.
5. **Action Bar** — Generate DOCX (Astryx `Button` disabled jika `Banner status:error` critical) + Download DOCX + `Badge` weight. Sticky bottom di mobile.
6. **Settings (`/settings`)** — 2 `Card` (OpenAI, Gemini) dengan `Field` + `TextInput type=password` + eye-toggle, `Badge` mask, Test Key `Button`, `Selector` model. Info `Banner status:info` enkripsi.
7. **Preview HTML** — `Card` tabel preview orientation `Badge` portrait/landscape, bukan PDF wajib.

Tidak ada Dashboard Admin, Approval Queue, Template Management, Analytics.

### TanStack Specifics (Via Astryx `Table`)

- **Table:** Astryx `Table` wrap `useReactTable({ data: weeklyPlans, columns, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel() })` dengan `columnHelper.accessor` memoized. Cell renderer: `material` → `TextArea`, `method` → `Selector` `1×(4×50")`, `weight` → `NumberInput`. `meta.updateData` untuk optimistic `PUT /api/rps/{id}`.
- **Query:** `useQuery({ queryKey: ["rps", id], queryFn: () => fetch(`/api/rps/${id}`).then(r=>r.json()) })`, `useQuery({ queryKey: ["api-keys"] })`, `useMutation` untuk `PUT`/`POST` dengan `onSuccess: qc.invalidateQueries({ queryKey: ["rps", id] })`. `staleTime: 30000`, `retry: 1`.
- **DevTools:** `<ReactQueryDevtools initialIsOpen={false} />` hanya `process.env.NODE_ENV==="development"`.

## Grid & Spacing — Via Astryx Tokens

Base 8px — pakai Astryx spacing tokens (`--astryx-spacing-*`), Tailwind `p-*` otomatis bridge via `tailwind-theme.css`.

| Token | Value | Tailwind (bridged) | Usage |
|:---|:---|:---|:---|
| xs | 4px | `p-1` | `Badge` padding |
| sm | 8px | `p-2` | `Stepper` gaps |
| md | 16px | `p-4` | `Card` padding |
| lg | 24px | `p-6` | Section gap |
| xl | 32px | `p-8` | Preview margin |

### Border Radius — Astryx Tokens

| Size | Value | Usage |
|:---|:---|:---|
| None | 0 | `Table` cells (Word grid faithful) |
| Small | 4px | `Field`/`Badge` |
| Medium | 8px | `Card`, `Button` |
| Large | 12px | Preview paper |

### Responsive Breakpoints

| Breakpoint | Width | Usage |
|:---|:---|:---|
| Mobile | 320–767px | Single column `Stepper`, `Table` horizontal scroll |
| Tablet | 768–1023px | `Stepper` + `Table` stacked |
| Desktop | 1024px+ | Form + Astryx `Table` side-by-side (optional) |

## Interaction & Motion — Via Astryx Tokens

### Hover States (Astryx `Button`/`Card` built-in)

| Element | Hover | Transition | Usage |
|:---|:---|:---|:---|
| Primary `Button` | `#1E3A5F` → `#234876`, shadow lift | 200ms ease-out | Generate AI, Generate DOCX |
| Secondary | `#F1F5F9` → `#E2E8F0` | 200ms | Back, Cancel |
| `Card` | `shadow 0 1px 3px` → `0 8px 20px` y -1px | 250ms | Draft cards |
| `Field` Focus | border `#E2E8F0` → `#1E3A5F`, ring `0 0 0 3px rgba(30,58,95,0.12)` | 150ms | All `Field` |

### Transitions & Animations

| Animation | Duration | Easing | Trigger | Usage |
|:---|:---|:---|:---|:---|
| Page Fade-In | 250ms | ease-out | Route change | `/` ↔ `/rps/[id]` |
| `Stepper` Slide | 300ms | ease-out | Next/Back | `Stepper` content |
| Weight Shake | 400ms | ease-out | Weight ≠100 | `Badge` Σ |
| `Toast` | 300ms in/out | ease-out | Save/audit/generate | Feedback |
| Skeleton Shimmer | 1.5s | ease-in-out | Query loading | `Table`/`Card` loading |
| Spinner | 1s | linear | AI generate | 15s spinner |

## Accessibility — Astryx Built-in + Checks

Astryx komponen sudah `role` + `aria-*` built-in, tetap verifikasi:

### Contrast Ratios

| Pair | Ratio | WCAG | Usage |
|:---|:---|:---|:---|
| Text Dark on White | 14.6:1 | AAA | Body |
| Primary on White | 11.2:1 | AAA | Links, `Button` |
| Error on White | 5.4:1 | AA | `Banner status:error` |
| Success on White | 6.2:1 | AA | `Badge variant:success` Σ=100 |

### Keyboard Navigation Essentials

- **`Stepper`:** `role="tablist"` built-in Astryx, arrow-key, `aria-selected` active.
- **`Table`:** `role="grid"` built-in Astryx `Table`, cell navigation; merged UTS/UAS `aria-label="UTS merged week 8, Bobot 15%"`.
- **`Field`:** Every `FieldLabel for`, errors `aria-describedby`, `Banner` `aria-live="polite"`.
- **API Key:** `TextInput type=password` dengan eye-toggle `aria-label`.
- **Focus ring:** 2px solid `#1E3A5F` offset 3px (Astryx token).
- **Skip link:** "Skip to stepper content" on focus.

### Checklist for Developers

- [ ] Axe/WAVE zero errors (Astryx `Table`/`Stepper` sudah test).
- [ ] Contrast ≥4.5:1 normal, 3:1 large (via `defineTheme` tokens).
- [ ] All `Field` labeled; `Banner` errors linked.
- [ ] Focus visible 2px.
- [ ] Semantic HTML (`AppShell` → `header`, `nav`, `main`, `Table` caption/th).
- [ ] `prefers-reduced-motion` respected.
- [ ] Touch targets ≥44×44px (Astryx `Button` min 40px, sesuaikan).
- [ ] Astryx `Table` keyboard navigable.

---

**Document Version:** 2.0-simple
**Last Updated:** 2026-09-10
**Status:** Ready for Development (Full Astryx + TanStack)
