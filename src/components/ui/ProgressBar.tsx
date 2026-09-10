export function ProgressBar({ value, max = 100 }: { value: number; max?: number }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const ok = value === max;
  return <div className="h-2 w-full rounded-full bg-slate-200 overflow-hidden"><div className={`h-full transition-all ${ok ? "bg-emerald-600" : "bg-amber-500"}`} style={{ width: `${pct}%` }} /></div>;
}
