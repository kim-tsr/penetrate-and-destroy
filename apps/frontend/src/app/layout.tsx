import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { connection } from "next/server";
import { Toaster } from "sonner";
import "./globals.css";

// Polices auto-hébergées (aucune requête vers un CDN : CSP font-src 'self').
const display = localFont({
  src: "./fonts/BigShoulders-latin-var.woff2",
  variable: "--font-bigshoulders",
  weight: "100 900",
  display: "swap",
});
const mono = localFont({
  src: [
    { path: "./fonts/JetBrainsMono-latin-var.woff2", style: "normal" },
    { path: "./fonts/JetBrainsMono-latin-var-italic.woff2", style: "italic" },
  ],
  variable: "--font-jbmono",
  weight: "100 800",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "PenetrateAndDestroy", template: "%s · PAD" },
  description: "Plateforme CTF jetable : challenges instanciés par équipe, accessibles via NetBird.",
  applicationName: "PenetrateAndDestroy",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0d0e10",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Rendu dynamique obligatoire : la CSP à nonce est posée par requête (proxy.ts).
  await connection();
  return (
    <html lang="fr" className={`${display.variable} ${mono.variable}`}>
      <body>
        <a
          href="#contenu"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:bg-amber focus:px-3 focus:py-1 focus:text-amber-ink"
        >
          Aller au contenu
        </a>
        {children}
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{
            style: {
              background: "var(--color-panel)",
              border: "1px solid var(--color-line-strong)",
              color: "var(--color-fg)",
              borderRadius: 0,
              fontFamily: "var(--font-mono)",
            },
          }}
        />
      </body>
    </html>
  );
}
