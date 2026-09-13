export type ApiErrorBody = {
  success?: false;
  error?: string;
  message?: string;
  /** Diisi endpoint yang memvalidasi dengan zod: `{ field: ["pesan"] }`. */
  errors?: Record<string, string[]>;
};

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;
  /** Error per-field dari validasi server, untuk ditempel ke input terkait. */
  readonly fieldErrors: Record<string, string[]>;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message ?? body.error ?? `HTTP ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
    this.fieldErrors = body.errors ?? {};
  }

  /** Sesi habis atau belum login — pemanggil sebaiknya arahkan ke halaman login. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /** Sudah login tapi di luar wewenang (mis. fakultas lain). */
  get isForbidden(): boolean {
    return this.status === 403;
  }
}

export async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const { headers, ...rest } = opts ?? {};
  const r = await fetch(path, {
    // Sesi admin memakai cookie httpOnly. Dev memakai proxy Vite sehingga
    // request tetap same-origin; ini membuatnya eksplisit alih-alih
    // bergantung pada default fetch.
    credentials: "same-origin",
    ...rest,
    // headers digabung setelah `rest` supaya Content-Type default tidak hilang
    // ketika pemanggil menyertakan header sendiri.
    headers: { "Content-Type": "application/json", ...(headers ?? {}) },
  });
  const j: unknown = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, (j ?? {}) as ApiErrorBody);
  return j as T;
}

export type ApiOk<T> = { success: true; data: T; message?: string; pagination?: { current_page:number; per_page:number; total:number; last_page:number; from:number; to:number } };
