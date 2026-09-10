export async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(path, { headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) }, ...opts });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.message ?? `HTTP ${r.status}`), { status: r.status, body: j });
  return j as T;
}
export type ApiOk<T> = { success: true; data: T; message?: string; pagination?: { current_page:number; per_page:number; total:number; last_page:number; from:number; to:number } };
