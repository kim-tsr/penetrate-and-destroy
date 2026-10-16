{
  description = "PenetrateAndDestroy - devshell reproductible (toutes les versions d'outils sont figées par flake.lock)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.05";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; config.allowUnfree = false; };

        # OpenTofu >= 1.10 est exigé par les stacks (required_version) ; nixos-25.05 n'embarque que la 1.9.x.
        # Plutôt qu'un second input nixpkgs, on épingle la release officielle (binaire Go statique) par sha256
        # (empreintes tirées du fichier tofu_<version>_SHA256SUMS de la release).
        tofuVersion = "1.10.6";
        tofuAssets = {
          x86_64-linux = { os = "linux"; arch = "amd64"; sha256 = "15b7bed76420b50da3e121769c43341df8cd57d751ca14e6dbe9c850124c6dac"; };
          aarch64-linux = { os = "linux"; arch = "arm64"; sha256 = "a32f653d686a8cad9b9be82101eb5b5e834fbfa8d095842fa1820c5d27fad967"; };
          x86_64-darwin = { os = "darwin"; arch = "amd64"; sha256 = "85115c8ec23b48b425259060347ff932355dad48056fa83ade05f7d890dc43ed"; };
          aarch64-darwin = { os = "darwin"; arch = "arm64"; sha256 = "6da8ee57f20113c302baeddc1f0c6340589fa1f7af04d41282e406cfa53c0b59"; };
        };
        tofuAsset = tofuAssets.${system};
        opentofu = pkgs.stdenvNoCC.mkDerivation {
          pname = "opentofu-bin";
          version = tofuVersion;
          src = pkgs.fetchurl {
            url = "https://github.com/opentofu/opentofu/releases/download/v${tofuVersion}/tofu_${tofuVersion}_${tofuAsset.os}_${tofuAsset.arch}.zip";
            inherit (tofuAsset) sha256;
          };
          nativeBuildInputs = [ pkgs.unzip ];
          sourceRoot = ".";
          dontConfigure = true;
          dontBuild = true;
          dontFixup = true; # binaire statique : pas de patchelf
          installPhase = ''
            install -Dm755 tofu $out/bin/tofu
          '';
        };

        # Le plugin kustomize `ksops` (nixpkgs : kustomize-sops) doit être dans le PATH pour que `kustomize build
        # --enable-alpha-plugins --enable-exec` déchiffre les secrets. On expose explicitement `bin/ksops`, quel que
        # soit le nom sous lequel le paquet installe l'exécutable.
        ksops = pkgs.runCommand "ksops-${pkgs.kustomize-sops.version}" { } ''
          mkdir -p $out/bin
          for name in ksops kustomize-sops ksops-exec; do
            bin=$(find -L ${pkgs.kustomize-sops} -type f -perm -u+x -name "$name" | sort | head -n1)
            if [ -n "$bin" ]; then
              ln -s "$bin" $out/bin/ksops
              break
            fi
          done
          test -x $out/bin/ksops
        '';

        # python3 par défaut : 3.12 avec PyYAML et Jinja2 (challenges/validate.py, monitoring/scripts/validate.py).
        # python311 : version de l'image officielle CTFd, utilisée par apps/ctfd/scripts/test.sh (python3.11).
        python = pkgs.python312.withPackages (ps: [ ps.pyyaml ps.jinja2 ]);
      in {
        devShells.default = pkgs.mkShell {
          packages = [
            python
            pkgs.python311
            opentofu
            ksops
          ] ++ (with pkgs; [
            # IaC
            ansible ansible-lint python3Packages.jmespath python3Packages.netaddr
            # Kubernetes
            kubectl kubernetes-helm kustomize kind clusterctl talosctl cilium-cli argocd kubeconform
            # Secrets
            sops age
            # task secrets:* (htpasswd : hash bcrypt de Zot/OPNsense ; ssh-keygen : clé de déploiement) et lint local
            apacheHttpd openssh gitleaks
            # Build / dev
            go-task go nodejs_22 pnpm yq-go jq git gh
            # Qualité / sécu / tests
            trivy checkov cosign syft k6 shellcheck actionlint
          ]);
          # Le shellHook s'exécute aussi dans `nix develop -c ...` : tout ce qu'il écrit sur stdout polluerait les
          # substitutions de commande ($(nix develop -c ...)). Il ne parle donc que sur stderr, et seulement en
          # session interactive.
          shellHook = ''
            export SOPS_AGE_KEY_FILE="''${SOPS_AGE_KEY_FILE:-$HOME/.config/sops/age/keys.txt}"
            export KUBECONFIG="$PWD/.state/kubeconfig"
            export TALOSCONFIG="$PWD/.state/talosconfig"
            if [ -t 1 ]; then
              echo "PenetrateAndDestroy devshell - task --list" >&2
            fi
          '';
        };
      });
}
