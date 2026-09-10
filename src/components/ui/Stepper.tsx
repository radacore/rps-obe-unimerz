export function Stepper({ steps, current, onStep }: { steps: string[]; current: number; onStep?: (i: number)=> void }) {
  return (
    <div className="flex items-center gap-2">
      {steps.map((s, i) => (
        <button key={s} onClick={() => onStep?.(i)} className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${i===current ? "bg-[#1E3A5F] text-white border-[#1E3A5F]" : i < current ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-white text-slate-600 border-slate-200"}`}>
          <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-xs ${i===current ? "bg-white text-[#1E3A5F]" : "bg-slate-100"}`}>{i+1}</span>{s}
        </button>
      ))}
    </div>
  );
}
