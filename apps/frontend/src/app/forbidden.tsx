import { StatusScreen } from "@/components/status-screen";

export default function Forbidden() {
  return (
    <StatusScreen code="403" title="Accès refusé">
      Ton rôle ne permet pas d&apos;ouvrir cette zone. Le portail manager est réservé aux groupes <code>ctf-managers</code> et <code>ctf-admins</code>.
    </StatusScreen>
  );
}
