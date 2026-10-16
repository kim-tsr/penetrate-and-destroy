import { http } from "msw";
import { fakeCtfd } from "./ctfd-fake";

/** Handlers msw (tests unitaires) : tout appel vers l'URL CTFd est servi par le CTFd simulé. */
export function ctfdHandlers(baseUrl: string) {
  const base = baseUrl.replace(/\/+$/, "");
  return [http.all(`${base}/*`, ({ request }) => fakeCtfd(request))];
}
