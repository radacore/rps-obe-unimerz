export function Badge({ variant = "default", children }: { variant?: "default" | "success" | "danger" | "warning"; children: React.ReactNode }) {
  const cls: Record<string,string> = {
    default: "bg-slate-100 text-slate-700 border-slate-200",
    success: "bg-emerald-50 text-emerald-700 border-emerald-200",
    danger: "bg-red-50 text-red-700 border-red-200",
    warning: "bg-amber-50 text-amber-800 border-amber-200",
  };
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${cls[variant]}`}>{children}</span>;
}
