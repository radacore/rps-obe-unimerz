import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api, type ApiOk } from "@/lib/api";
import { Card } from "./ui/Card";
import { Badge } from "./ui/Badge";
export function DraftList() {
  const { data, isLoading } = useQuery({ queryKey: ["rps"], queryFn: () => api<ApiOk<{ id:number; course_name:string; course_code:string; semester:string; status:string; updated_at:string }[]>>("/api/rps") });
  if (isLoading) return <div className="text-sm text-slate-500">Memuat…</div>;
  const rows = data?.data ?? [];
  if (rows.length===0) return <Card><div className="py-8 text-center text-sm text-slate-600">Belum ada draft. Buat RPS baru di bawah.</div></Card>;
  return (
    <div className="grid gap-3">
      {rows.map(r => (
        <Link key={r.id} to="/rps/$id" params={{ id: String(r.id) }}>
          <Card className="hover:border-[#1E3A5F]/30 transition">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-slate-900">{r.course_name} <span className="font-mono text-xs text-slate-500">({r.course_code})</span></div>
                <div className="text-xs text-slate-500">Semester {r.semester} · {new Date(r.updated_at).toLocaleDateString("id-ID")}</div>
              </div>
              <Badge variant={r.status==="generated" ? "success" : "default"}>{r.status}</Badge>
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}
