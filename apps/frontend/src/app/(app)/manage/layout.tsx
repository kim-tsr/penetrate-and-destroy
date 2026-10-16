import { requirePageSession } from "@/lib/session";

/** Portail manager : réservé aux rôles manager et admin (revérifié ici, en plus du proxy). */
export default async function ManageLayout({ children }: { children: React.ReactNode }) {
  await requirePageSession("manager");
  return children;
}
