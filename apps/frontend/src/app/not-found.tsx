import { StatusScreen } from "@/components/status-screen";

export default function NotFound() {
  return (
    <StatusScreen code="404" title="Cible introuvable">
      Cette page n&apos;existe pas, ou le challenge demandé n&apos;est pas (ou plus) visible pour toi.
    </StatusScreen>
  );
}
