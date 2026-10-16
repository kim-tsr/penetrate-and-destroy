/** Appels du navigateur vers le BFF (même origine, cookies de session Auth.js uniquement). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details: string[] = [],
    readonly retryAfter: number | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(path: string, init: { method?: string; json?: unknown; form?: FormData; signal?: AbortSignal } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  let body: BodyInit | undefined;
  if (init.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.json);
  } else if (init.form) {
    body = init.form;
  }
  let res: Response;
  try {
    res = await fetch(path, { method: init.method ?? "GET", headers, body, cache: "no-store", signal: init.signal });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError(0, "Réseau indisponible");
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (res.status === 401) {
    // Session expirée : retour à la connexion en conservant la page demandée.
    const login = new URL("/login", window.location.origin);
    login.searchParams.set("callbackUrl", window.location.pathname);
    window.location.href = login.toString();
  }
  if (!res.ok) {
    const b = (data ?? {}) as { error?: string; details?: string[]; retryAfter?: number };
    throw new ApiError(res.status, b.error ?? `Erreur ${res.status}`, b.details ?? [], b.retryAfter ?? null);
  }
  return data as T;
}
