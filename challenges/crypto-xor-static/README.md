# XOR Warmup (solution orgas)

`cipher.bin` = flag XOR clé répétée de 4 octets (`gen.py`, déterministe).
Résolution : known-plaintext, `PAD{` XOR les 4 premiers octets donne la clé `5ec0ffee`, puis déchiffrer le tout.
Régénérer : `python3 gen.py cipher.bin`.
