import { StatusScreen } from "@/components/status-screen";
import { ButtonLink } from "@/components/ui/button";

export default function Unauthorized() {
  return (
    <StatusScreen code="401" title="Session requise" action={<ButtonLink href="/login">Se connecter</ButtonLink>}>
      Ta session a expiré ou tu n&apos;es pas connecté.
    </StatusScreen>
  );
}
