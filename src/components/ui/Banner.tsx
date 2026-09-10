export function Banner({ status = "info", title, children }: { status?: "info" | "success" | "warning" | "error"; title?: string; children: React.ReactNode }) {
  const cls: Record<string,string> = {
    info: "bg-sky-50 border-sky-200 text-sky-900",
    success: "bg-emerald-50 border-emerald-200 text-emerald-900",
    warning: "bg-amber-50 border-amber-200 text-amber-900",
    error: "bg-red-50 border-red-200 text-red-900",
  };
  return <div className={`rounded-lg border p-3 text-sm ${cls[status]}`}>{title && <div className="font-semibold mb-1">{title}</div>}<div>{children}</div></div>;
}
