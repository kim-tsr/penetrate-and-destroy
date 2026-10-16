"use client";

/** Dernier filet : remplace le layout racine, donc ne dépend d'aucun composant ni police du projet. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="fr">
      <body style={{ background: "#0d0e10", color: "#efe7d3", fontFamily: "ui-monospace, monospace", padding: "4rem 1.5rem" }}>
        <h1 style={{ fontSize: "2.5rem", textTransform: "uppercase" }}>Erreur critique</h1>
        <p>Le front a rencontré une erreur inattendue.</p>
        <button
          type="button"
          onClick={reset}
          style={{ marginTop: "1rem", background: "#ffb000", color: "#1a1203", border: 0, padding: "0.6rem 1.2rem", fontWeight: 700 }}
        >
          Réessayer
        </button>
      </body>
    </html>
  );
}
