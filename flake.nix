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
      in {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            # IaC
            opentofu ansible ansible-lint python3Packages.jmespath python3Packages.netaddr
            # Kubernetes
            kubectl kubernetes-helm kustomize kind clusterctl talosctl cilium-cli argocd kubeconform
            # Secrets
            sops age
            # task secrets:* (htpasswd : hash bcrypt de Zot/OPNsense ; ssh-keygen : clé de déploiement) et lint local
            apacheHttpd openssh gitleaks
            # Build / dev
            go-task go nodejs_22 pnpm python312 yq-go jq git gh
            # Qualité / sécu / tests
            trivy checkov cosign syft k6 shellcheck
          ];
          shellHook = ''
            export SOPS_AGE_KEY_FILE="''${SOPS_AGE_KEY_FILE:-$HOME/.config/sops/age/keys.txt}"
            export KUBECONFIG="$PWD/.state/kubeconfig"
            export TALOSCONFIG="$PWD/.state/talosconfig"
            echo "PenetrateAndDestroy devshell - task --list"
          '';
        };
      });
}
