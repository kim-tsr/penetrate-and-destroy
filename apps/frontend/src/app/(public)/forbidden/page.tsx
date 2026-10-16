import Forbidden from "@/app/forbidden";

/** Cible du `rewrite` du proxy lorsqu'un joueur ouvre une zone réservée aux managers. */
export default function ForbiddenPage() {
  return <Forbidden />;
}
