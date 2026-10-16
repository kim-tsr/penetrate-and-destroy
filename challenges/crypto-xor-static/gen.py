#!/usr/bin/env python3
"""Génère cipher.bin de façon déterministe : flag XOR clé répétée de 4 octets."""
import sys

FLAG = b"PAD{x0r_k3y_is_4_byt3s_l0ng}"
KEY = bytes.fromhex("5ec0ffee")

out = bytes(b ^ KEY[i % len(KEY)] for i, b in enumerate(FLAG))
with open(sys.argv[1] if len(sys.argv) > 1 else "cipher.bin", "wb") as f:
    f.write(out)
