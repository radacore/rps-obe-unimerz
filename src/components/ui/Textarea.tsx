import { useId } from "react";
import { Field as AstryxField } from "@astryxdesign/core/Field";

/**
 * Textarea multi-baris berwrapper Astryx `Field` supaya label, error, dan
 * hint mengikuti sistem yang sama dengan `TextInput`.
 *
 * Astryx belum menyediakan komponen textarea di paket `core`, jadi elemen
 * `textarea` bawaan tetap dipakai dengan token warna & radius yang selaras
 * (`border-border`, `bg-surface`, dst.) supaya visualnya konsisten dengan
 * `TextInput` dan tidak menonjol seperti kontrol asing.
 */
export function Textarea({
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  rows,
  hint,
  error,
  minRows = 4,
  maxRows = 14,
  autoSize = true,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  rows?: number;
  hint?: string;
  error?: string;
  /** Batas bawah tinggi saat isian sedikit. */
  minRows?: number;
  /** Batas atas tinggi supaya tidak menyerobot viewport bila isian panjang. */
  maxRows?: number;
  /** Ikutkan tinggi ke jumlah baris (default true); matikan bila `rows` ditentukan. */
  autoSize?: boolean;
}) {
  const id = useId();
  const status = error ? ({ type: "error" as const, message: error } as const) : undefined;
  // Auto-height dihitung dari jumlah baris teks: mengurangi 'jendela kecil'
  // untuk pengisi yang panjang, tapi tetap dibatasi maxRows.
  const jumlahBaris = value.split("\n").length + 1;
  const computedRows = autoSize && rows === undefined
    ? Math.min(maxRows, Math.max(minRows, jumlahBaris))
    : rows ?? minRows;

  return (
    <AstryxField label={label} inputID={id} description={hint} status={status}>
      <textarea
        id={id}
        className="min-h-[112px] w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm leading-relaxed text-primary placeholder:text-secondary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        rows={computedRows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
    </AstryxField>
  );
}
