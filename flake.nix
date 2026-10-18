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

        # kind : version exacte du contrat (kubernetes.kind_version, image de nœud associée) ; nixpkgs est en retard.
        # Empreintes tirées des fichiers kind-<os>-<arch>.sha256sum de la release.
        kindVersion = "0.33.0";
        kindAssets = {
          x86_64-linux = { os = "linux"; arch = "amd64"; sha256 = "aee6151561422756b764a4ae28e7f44cda5af5a9eead3cc9985112b1de8d8e0d"; };
          aarch64-linux = { os = "linux"; arch = "arm64"; sha256 = "20022bee6cfcd5086cb7234d218e3454e6090022f2a8f55d1fa7fcf42c3867a2"; };
          x86_64-darwin = { os = "darwin"; arch = "amd64"; sha256 = "5a99f26f57246dc9319dd294803313197a0f34d33c525b3ea8b655db5916ece0"; };
          aarch64-darwin = { os = "darwin"; arch = "arm64"; sha256 = "0c8c7dbe5e23594a198b786c4bc13dacc101fa6196b0cb0b23a1ca44e61f4b4f"; };
        };
        kindAsset = kindAssets.${system};
        kind = pkgs.stdenvNoCC.mkDerivation {
          pname = "kind-bin";
          version = kindVersion;
          src = pkgs.fetchurl {
            url = "https://github.com/kubernetes-sigs/kind/releases/download/v${kindVersion}/kind-${kindAsset.os}-${kindAsset.arch}";
            inherit (kindAsset) sha256;
          };
          dontUnpack = true;
          dontConfigure = true;
          dontBuild = true;
          dontFixup = true; # binaire statique
          installPhase = ''
            install -Dm755 $src $out/bin/kind
          '';
        };

        # clusterctl : version exacte du contrat (kubernetes.capi.core) ; nixpkgs est en retard (1.10 ne gère pas les
        # providers v1beta2 récents). Empreintes calculées sur les binaires de la release GitHub v1.14.3.
        clusterctlVersion = "1.14.3";
        clusterctlAssets = {
          x86_64-linux = { os = "linux"; arch = "amd64"; sha256 = "e56f397f55c6fdde6ee8c0fead4fb21270a50e05111180bf68c8ae6c82dfd917"; };
          aarch64-linux = { os = "linux"; arch = "arm64"; sha256 = "eea3a3ecc64ae155c57eea35378d833285a92cb549c3298a18765bc40a7a3f7b"; };
          x86_64-darwin = { os = "darwin"; arch = "amd64"; sha256 = "decec263200ff5790593fcff64a0f9d42799410b91b1e23c86ec1437607bb1fd"; };
          aarch64-darwin = { os = "darwin"; arch = "arm64"; sha256 = "5915523f13949884d29d5254445b8d294ba314b5dacb3e8eff9e42f1c9d2e684"; };
        };
        clusterctlAsset = clusterctlAssets.${system};
        clusterctl = pkgs.stdenvNoCC.mkDerivation {
          pname = "clusterctl-bin";
          version = clusterctlVersion;
          src = pkgs.fetchurl {
            url = "https://github.com/kubernetes-sigs/cluster-api/releases/download/v${clusterctlVersion}/clusterctl-${clusterctlAsset.os}-${clusterctlAsset.arch}";
            inherit (clusterctlAsset) sha256;
          };
          dontUnpack = true;
          dontConfigure = true;
          dontBuild = true;
          dontFixup = true; # binaire statique
          installPhase = ''
            install -Dm755 $src $out/bin/clusterctl
          '';
        };

        # talosctl : doit suivre la version de Talos du contrat (kubernetes.talos_version). Empreintes tirées du
        # fichier sha256sum.txt de la release v1.11.6.
        talosctlVersion = "1.11.6";
        talosctlAssets = {
          x86_64-linux = { os = "linux"; arch = "amd64"; sha256 = "a248ef5c5f9cab08013281e6e14d8d8862e7363515e58e2fba8c94ca05c5cf34"; };
          aarch64-linux = { os = "linux"; arch = "arm64"; sha256 = "39c4e3d1bda2870a2de5a4f30a6f728914d3d27da5bf75380387717d75ed694a"; };
          x86_64-darwin = { os = "darwin"; arch = "amd64"; sha256 = "cf2fb9d1fbd42a09386de19d6dbb766e0a532209b001dfe2ac5e7d471f967b63"; };
          aarch64-darwin = { os = "darwin"; arch = "arm64"; sha256 = "72f77fbc522ddb215df7c262d0f65b2074cf3874f233f29e952694b32da06dd3"; };
        };
        talosctlAsset = talosctlAssets.${system};
        talosctl = pkgs.stdenvNoCC.mkDerivation {
          pname = "talosctl-bin";
          version = talosctlVersion;
          src = pkgs.fetchurl {
            url = "https://github.com/siderolabs/talos/releases/download/v${talosctlVersion}/talosctl-${talosctlAsset.os}-${talosctlAsset.arch}";
            inherit (talosctlAsset) sha256;
          };
          dontUnpack = true;
          dontConfigure = true;
          dontBuild = true;
          dontFixup = true; # binaire statique
          installPhase = ''
            install -Dm755 $src $out/bin/talosctl
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
            kind
            clusterctl
            talosctl
            ksops
          ] ++ (with pkgs; [
            # IaC
            ansible ansible-lint python3Packages.jmespath python3Packages.netaddr
            # Kubernetes
            kubectl kubernetes-helm kustomize cilium-cli argocd kubeconform
            # Secrets
            sops age
            # task secrets:* (htpasswd : hash bcrypt de Zot/OPNsense ; ssh-keygen : clé de déploiement) et lint local
            apacheHttpd openssh gitleaks
            # Build / dev
            go-task go nodejs_22 pnpm yq-go jq git gh
            # Qualité / sécu / tests
            trivy checkov cosign syft k6 shellcheck actionlint
            # Registres OCI (task apps:pin-digests, apps:zot:publish)
            crane oras
          ]);
          # Le shellHook s'exécute aussi dans `nix develop -c ...` : tout ce qu'il écrit sur stdout polluerait les
          # substitutions de commande ($(nix develop -c ...)). Il ne parle donc que sur stderr, et seulement en
          # session interactive.
          shellHook = ''
            export SOPS_AGE_KEY_FILE="''${SOPS_AGE_KEY_FILE:-$HOME/.config/sops/age/keys.txt}"
            export KUBECONFIG="$PWD/.state/kubeconfig"
            export TALOSCONFIG="$PWD/.state/talosconfig"
            # libstdc++ de nix : les roues manylinux du venv du harnais CTFd (greenlet) l'attendent et ne la trouvent
            # pas dans l'environnement nix ; apps/ctfd/scripts/test.sh l'ajoute à LD_LIBRARY_PATH pour ce venv seul.
            export PAD_LIBSTDCXX_DIR="${pkgs.stdenv.cc.cc.lib}/lib"
            if [ -t 1 ]; then
              echo "PenetrateAndDestroy devshell - task --list" >&2
            fi
          '';
        };
      });
}
