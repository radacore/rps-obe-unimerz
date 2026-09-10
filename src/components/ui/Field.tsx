export function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1.5 text-sm"><span className="font-medium text-slate-800">{label}</span>{children}{error ? <span className="text-xs text-red-600">{error}</span> : hint ? <span className="text-xs text-slate-500">{hint}</span> : null}</label>;
}
