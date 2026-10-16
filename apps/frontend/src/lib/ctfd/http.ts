import "server-only";
import { isMockMode } from "../env";
import { getMetrics } from "../metrics";
import { logger } from "../logger";
import { errorMessage } from "./adapter";

/** Erreur d'appel CTFd, porteuse du statut HTTP pour que le BFF le relaie proprement. */
export class CtfdError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown = null,
  ) {
    super(message);
    this.name = "CtfdError";
  }
}

export interface CtfdRequest {
  path: string; // ex: "/api/v1/challenges"
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  token?: string | null;
  json?: unknown;
  form?: FormData;
  query?: Record<string, string | number | undefined>;
  headers?: Record<string, string>;
  /** Corps déjà sérialisé (signature HMAC calculée sur ces octets exacts). */
  rawBody?: string;
  timeoutMs?: number;
  /** Libellé stable pour les métriques (évite l'explosion de cardinalité). */
  endpoint: string;
}

export function ctfdBaseUrl(): string {
  return (process.env.CTFD_URL ?? "http://ctfd.ctfd.svc.cluster.local:8000").replace(/\/+$/, "");
}

export async function ctfdFetch(req: CtfdRequest): Promise<Response> {
  const url = new URL(ctfdBaseUrl() + req.path);
  for (const [k, v] of Object.entries(req.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
  const headers = new Headers({ Accept: "application/json", ...req.headers });
  if (req.token) headers.set("Authorization", `Token ${req.token}`);
  let body: BodyInit | undefined;
  if (req.rawBody !== undefined) {
    body = req.rawBody;
    headers.set("Content-Type", "application/json");
  } else if (req.form) {
    body = req.form;
  } else if (req.json !== undefined) {
    body = JSON.stringify(req.json);
    headers.set("Content-Type", "application/json");
  } else if (req.token) {
    // CTFd 3.8 ne connecte le porteur d'un `Authorization: Token` que si la requête est en JSON
    // (`request.is_json`), même sans corps : sans ce Content-Type, l'API native (users/me,
    // challenges...) répond 302 vers /login (apps/ctfd/API.md, section 1.1).
    headers.set("Content-Type", "application/json");
  }
  const method = req.method ?? "GET";
  const end = getMetrics().upstreamDuration.startTimer({ endpoint: req.endpoint, method });
  try {
    const signal = AbortSignal.timeout(req.timeoutMs ?? 8000);
    let res: Response;
    if (isMockMode()) {
      // PAD_MOCK=1 (jamais en production) : CTFd simulé en mémoire, même chemin de code ensuite.
      const { fakeCtfd } = await import("../../mocks/ctfd-fake");
      res = await fakeCtfd(new Request(url, { method, headers, body, signal }));
    } else {
      res = await fetch(url, { method, headers, body, cache: "no-store", redirect: "manual", signal });
    }
    end({ status: String(res.status) });
    return res;
  } catch (err) {
    end({ status: "error" });
    // Next interrompt le rendu statique via une exception « dynamic usage » : à relayer telle quelle.
    if ((err as { digest?: string }).digest === "DYNAMIC_SERVER_USAGE") throw err;
    logger.error({ endpoint: req.endpoint, err: (err as Error).message }, "appel CTFd en échec");
    throw new CtfdError(502, "CTFd ne répond pas");
  }
}

/** Appel JSON : renvoie le corps parsé ou lève `CtfdError` avec le message CTFd. */
export async function ctfdJson(req: CtfdRequest, okStatuses: readonly number[] = []): Promise<unknown> {
  const res = await ctfdFetch(req);
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (!res.ok && !okStatuses.includes(res.status)) {
    // Une redirection signifie en pratique « non authentifié » sur CTFd.
    const status = res.status >= 300 && res.status < 400 ? 401 : res.status;
    throw new CtfdError(status, errorMessage(body) ?? `CTFd a répondu ${res.status}`, body);
  }
  return body;
}
