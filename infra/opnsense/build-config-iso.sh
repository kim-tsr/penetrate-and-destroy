#!/usr/bin/env bash
# Construit l'ISO 9660 d'import OPNsense : <src>/conf/config.xml -> <out>.iso (racine : /conf/config.xml).
# Appelé par le module tofu opnsense-vm (null_resource local-exec). Reproductible : dates figées.
# Outils essayés dans l'ordre : xorriso, mkisofs, genisoimage, `nix shell nixpkgs#xorriso`, hdiutil (macOS).
set -euo pipefail

src="${1:?usage: build-config-iso.sh <src_dir contenant conf/config.xml> <out.iso>}"
out="${2:?usage: build-config-iso.sh <src_dir> <out.iso>}"
label="OPNCONF"

[ -f "$src/conf/config.xml" ] || { echo "config.xml absent de $src/conf" >&2; exit 1; }
mkdir -p "$(dirname "$out")"
rm -f "$out"

# Dates figées pour un ISO identique à contenu identique.
export SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-0}"
touch -d "@${SOURCE_DATE_EPOCH}" "$src/conf/config.xml" "$src/conf" 2>/dev/null || true

mkiso_args=(-V "$label" -J -R -o "$out" "$src")

if command -v xorriso >/dev/null 2>&1; then
  xorriso -as mkisofs "${mkiso_args[@]}"
elif command -v mkisofs >/dev/null 2>&1; then
  mkisofs "${mkiso_args[@]}"
elif command -v genisoimage >/dev/null 2>&1; then
  genisoimage "${mkiso_args[@]}"
elif command -v nix >/dev/null 2>&1; then
  nix --extra-experimental-features 'nix-command flakes' shell nixpkgs#xorriso -c xorriso -as mkisofs "${mkiso_args[@]}"
elif command -v hdiutil >/dev/null 2>&1; then
  # macOS sans nix : ISO 9660 + Joliet natif.
  hdiutil makehybrid -quiet -iso -joliet -default-volume-name "$label" -o "$out" "$src"
else
  echo "Aucun outil ISO disponible (xorriso/mkisofs/genisoimage/nix/hdiutil)." >&2
  exit 1
fi

echo "ISO de config OPNsense : $out"
