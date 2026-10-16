# Ret2Win (solution orgas)

`gets()` dans un buffer de 64 octets, sans canary ni PIE. Offset = 64 + 8 (rbp) = 72, puis l'adresse de `win` (`nm chall`).
Padding de 72 octets, éventuel `ret` d'alignement (movaps), puis `win`, qui affiche `$FLAG` (env de l'instance).
Binaire non strippé pour que `nm` fonctionne. Build reproductible : base épinglée par digest, `SOURCE_DATE_EPOCH`,
`-ffile-prefix-map`, build-id désactivé.
