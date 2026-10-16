// Scénario chall-manager générique de PenetrateAndDestroy.
//
// Format (ctfer-io/chall-manager v0.6.6) : projet Pulumi Go prébuilt, packagé en artefact OCI
// (artifactType application/vnd.ctfer-io.scenario, layers application/vnd.ctfer-io.file :
// `Pulumi.yaml` + binaire `main`), cf. build.sh. Le SDK chall-manager fournit l'identité de
// l'instance et la configuration `additional` (map clé=valeur de chaînes, fusion challenge+instance).
//
// Clés `additional` (instance_config du challenge côté CTFd) :
//
//	image             obligatoire, image du conteneur (de préférence tag@sha256)
//	ports             "8080/tcp,53/udp" (défaut 8080/tcp) ; le premier sert à connection_info
//	flag              flag servi dans l'env FLAG ; avec variate=true il est varié par identité
//	variate           true|false (défaut false)
//	env_<NOM>         variables d'environnement additionnelles
//	requests_cpu|memory, limits_cpu|memory|ephemeral-storage   quantités Kubernetes
//	run_as_user       UID (défaut 10001) ; read_only_rootfs true|false
//	pad_source_kind, pad_source_id, pad_challenge_id           posés par le plugin CTFd (labels)
//
// Paramètres d'infrastructure (env du process chall-manager) : PAD_FROM_CIDRS,
// PAD_LB_POOL, PAD_LB_POOL_LABEL (défauts = infra/contracts.yaml).
package main

import (
	"strconv"

	"github.com/ctfer-io/chall-manager/sdk"
	"github.com/pulumi/pulumi/sdk/v3/go/pulumi"
)

func main() {
	sdk.Run(func(req *sdk.Request, resp *sdk.Response, opts ...pulumi.ResourceOption) error {
		pol, err := PolicyFromEnv(osGetenv)
		if err != nil {
			return err
		}
		cfg, err := ParseConfig(req.Config.Identity, req.Config.Additional, pol)
		if err != nil {
			return err
		}
		if v := req.Config.Additional["variate"]; v != "" && cfg.Flag != "" {
			variate, err := strconv.ParseBool(v)
			if err != nil {
				return err
			}
			if variate {
				cfg.Flag = sdk.Variate(req.Config.Identity, cfg.Flag)
			}
		}

		info, err := Build(req.Ctx, cfg, opts...)
		if err != nil {
			return err
		}
		resp.ConnectionInfo = info
		flags := []string{}
		if cfg.Flag != "" {
			flags = append(flags, cfg.Flag)
		}
		resp.Flags = pulumi.ToStringArray(flags).ToStringArrayOutput()
		return nil
	})
}
