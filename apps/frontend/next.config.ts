import type { NextConfig } from "next";

/**
 * Le front est servi par une image Docker `output: standalone` sur Kubernetes (pas Vercel).
 * Les en-têtes de sécurité dynamiques (CSP avec nonce) sont posés par `src/proxy.ts` ;
 * ceux qui ne dépendent pas de la requête sont posés ici pour couvrir aussi les assets statiques.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // `next dev` n'écrit pas de fichier AGENTS.md dans le dépôt.
  agentRules: false,
  // Identifiant de build déterministe (reproductibilité de l'image) ; défaut stable hors CI.
  generateBuildId: async () => process.env.PAD_BUILD_ID || "pad-frontend-dev",
  reactStrictMode: true,
  // Ces paquets reposent sur des modules natifs Node ou des chargements dynamiques :
  // on les laisse hors du bundle serveur (ils sont copiés dans .next/standalone par le tracing).
  serverExternalPackages: [
    "pino",
    "ioredis",
    "prom-client",
    "@opentelemetry/sdk-node",
    "@opentelemetry/exporter-trace-otlp-grpc",
    "@grpc/grpc-js",
    "msw",
  ],
  experimental: {
    // forbidden() / unauthorized() pour les contrôles de rôle dans les pages et server actions.
    authInterrupts: true,
    // Import de ZIP de challenges par le portail manager (server actions) : 50 Mo max.
    serverActions: { bodySizeLimit: "50mb" },
    proxyClientMaxBodySize: "50mb",
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
