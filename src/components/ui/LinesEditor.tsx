import { useState } from "react";
import { Text } from "@astryxdesign/core/Text";

/**
 * Textarea satu-baris-satu-entri untuk daftar teks (misi, tujuan, profil
 * lulusan). Perubahan dikirim saat blur, bukan setiap ketikan, supaya baris
 * yang sedang diketik tidak terpotong di tengah.
 *
 * Komponen ini tidak menyelaraskan diri dengan prop `value` yang berubah —
 * pemanggil wajib memberi `key` yang berganti (mis. slug entitas) supaya
 * remount terjadi. Penyelarasan lewat efek akan menimpa editan pengguna
 * setiap kali data di-refetch di latar belakang.
 */
export function LinesEditor({
  label, hint, value, onChange, placeholder = "Satu entri per baris",
}: {
  label: string;
  hint?: string;
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState(value.join("\n"));
  return (
    <div className="grid gap-1">
      <Text weight="semibold">{label}</Text>
      {hint && <Text type="supporting">{hint}</Text>}
      <textarea
        className="min-h-[112px] w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm leading-relaxed text-primary placeholder:text-secondary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        rows={Math.min(14, Math.max(4, value.length + 2))}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => onChange(text.split("\n").map((s) => s.trim()).filter(Boolean))}
        placeholder={placeholder}
      />
      <Text type="supporting">{value.length} entri</Text>
    </div>
  );
}
