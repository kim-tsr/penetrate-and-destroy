/** Construction de la CSP stricte (nonce par requête + strict-dynamic). */
export function buildCsp(nonce: string, opts: { dev: boolean; formActions?: string[] }): string {
  const formAction = ["'self'", ...(opts.formActions ?? [])].join(" ");
  const directives: Record<string, string> = {
    "default-src": "'self'",
    "script-src": `'self' 'nonce-${nonce}' 'strict-dynamic'${opts.dev ? " 'unsafe-eval'" : ""}`,
    // Les styles inline (attributs style posés par React/Motion/Recharts) restent autorisés :
    // le risque XSS est porté par script-src, qui lui est strict.
    "style-src": "'self' 'unsafe-inline'",
    "img-src": "'self' data: blob:",
    "font-src": "'self'",
    "connect-src": opts.dev ? "'self' ws: wss:" : "'self'",
    "media-src": "'self'",
    "object-src": "'none'",
    "base-uri": "'self'",
    // La connexion OIDC redirige vers Authentik après soumission de formulaire.
    "form-action": formAction,
    "frame-ancestors": "'none'",
    "frame-src": "'none'",
    "worker-src": "'self' blob:",
    "manifest-src": "'self'",
  };
  const csp = Object.entries(directives).map(([k, v]) => `${k} ${v}`);
  if (!opts.dev) csp.push("upgrade-insecure-requests");
  return csp.join("; ");
}

export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
