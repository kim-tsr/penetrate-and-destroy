package main

import (
	"fmt"

	appsv1 "github.com/pulumi/pulumi-kubernetes/sdk/v4/go/kubernetes/apps/v1"
	corev1 "github.com/pulumi/pulumi-kubernetes/sdk/v4/go/kubernetes/core/v1"
	metav1 "github.com/pulumi/pulumi-kubernetes/sdk/v4/go/kubernetes/meta/v1"
	netv1 "github.com/pulumi/pulumi-kubernetes/sdk/v4/go/kubernetes/networking/v1"
	"github.com/pulumi/pulumi/sdk/v3/go/pulumi"
)

// Pool de nœuds des challenges.
// contracts: kubernetes.pools.challenges.taint (pad.io/pool=challenges:NoSchedule)
const (
	poolKey   = "pad.io/pool"
	poolValue = "challenges"
	// Label de namespace déclenchant la CiliumNetworkPolicy DNS (gitops/platform/kyverno/policies/instance-guardrails.yaml).
	DNSLabel      = "pad.io/dns"
	DNSLabelValue = "cluster-local"
	// NetworkPolicy du scénario (la `default-deny` vide est générée par Kyverno).
	NetworkPolicyName = "pad-instance"
)

// Build déclare toutes les ressources d'une instance et renvoie la connection_info (IP LB:port).
func Build(ctx *pulumi.Context, c *Config, opts ...pulumi.ResourceOption) (pulumi.StringOutput, error) {
	labels := pulumi.ToStringMap(c.Labels)
	selector := pulumi.StringMap{
		"app.kubernetes.io/name":     pulumi.String("pad-instance"),
		"app.kubernetes.io/instance": pulumi.String(LabelValue(c.Identity)),
	}

	// Namespace dédié : PSS restricted (cf. Kyverno de la plateforme).
	nsLabels := pulumi.ToStringMap(c.Labels)
	for k, v := range map[string]string{
		"pod-security.kubernetes.io/enforce":         "restricted",
		"pod-security.kubernetes.io/enforce-version": "latest",
	} {
		nsLabels[k] = pulumi.String(v)
	}
	if c.DNS {
		// Opt-in : Kyverno (generate) pose alors la CiliumNetworkPolicy qui limite le DNS à cluster.local.
		nsLabels[DNSLabel] = pulumi.String(DNSLabelValue)
	}
	ns, err := corev1.NewNamespace(ctx, "namespace", &corev1.NamespaceArgs{
		Metadata: metav1.ObjectMetaArgs{
			Name:   pulumi.String(c.Namespace),
			Labels: nsLabels,
		},
	}, opts...)
	if err != nil {
		return pulumi.StringOutput{}, err
	}
	nsName := ns.Metadata.Name().Elem()

	// Deployment.
	envs := corev1.EnvVarArray{}
	for _, k := range c.EnvKeys() {
		envs = append(envs, corev1.EnvVarArgs{Name: pulumi.String(k), Value: pulumi.String(c.Env[k])})
	}
	if c.Flag != "" {
		envs = append(envs, corev1.EnvVarArgs{Name: pulumi.String("FLAG"), Value: pulumi.String(c.Flag)})
	}
	ports := corev1.ContainerPortArray{}
	for _, p := range c.Ports {
		ports = append(ports, corev1.ContainerPortArgs{
			Name:          pulumi.String(p.Name()),
			ContainerPort: pulumi.Int(p.Number),
			Protocol:      pulumi.String(p.Protocol),
		})
	}

	podSpec := corev1.PodSpecArgs{
		AutomountServiceAccountToken: pulumi.Bool(false),
		EnableServiceLinks:           pulumi.Bool(false),
		// User namespace : root du conteneur != root de l'hôte (limite l'impact d'une évasion). K8s >= 1.33.
		HostUsers:    pulumi.Bool(c.Policy.HostUsers),
		HostNetwork:  pulumi.Bool(false),
		HostPID:      pulumi.Bool(false),
		HostIPC:      pulumi.Bool(false),
		NodeSelector: pulumi.StringMap{poolKey: pulumi.String(poolValue)},
		Tolerations: corev1.TolerationArray{
			corev1.TolerationArgs{
				Key:      pulumi.String(poolKey),
				Operator: pulumi.String("Equal"),
				Value:    pulumi.String(poolValue),
				Effect:   pulumi.String("NoSchedule"),
			},
		},
		SecurityContext: corev1.PodSecurityContextArgs{
			RunAsNonRoot:   pulumi.Bool(true),
			RunAsUser:      pulumi.Int(int(c.RunAsUser)),
			SeccompProfile: corev1.SeccompProfileArgs{Type: pulumi.String("RuntimeDefault")},
		},
		Containers: corev1.ContainerArray{
			corev1.ContainerArgs{
				Name:  pulumi.String("challenge"),
				Image: pulumi.String(c.Image),
				Ports: ports,
				Env:   envs,
				Resources: corev1.ResourceRequirementsArgs{
					Requests: pulumi.ToStringMap(c.Requests),
					Limits:   pulumi.ToStringMap(c.Limits),
				},
				SecurityContext: corev1.SecurityContextArgs{
					AllowPrivilegeEscalation: pulumi.Bool(false),
					Privileged:               pulumi.Bool(false),
					ReadOnlyRootFilesystem:   pulumi.Bool(c.ReadOnlyFS),
					Capabilities:             corev1.CapabilitiesArgs{Drop: pulumi.StringArray{pulumi.String("ALL")}},
					SeccompProfile:           corev1.SeccompProfileArgs{Type: pulumi.String("RuntimeDefault")},
				},
			},
		},
	}
	if c.Policy.RuntimeClass != "" {
		// Option sandbox noyau (gVisor/Kata) : la RuntimeClass doit exister sur le pool challenges.
		podSpec.RuntimeClassName = pulumi.String(c.Policy.RuntimeClass)
	}

	_, err = appsv1.NewDeployment(ctx, "deployment", &appsv1.DeploymentArgs{
		Metadata: metav1.ObjectMetaArgs{
			Name:      pulumi.String("instance"),
			Namespace: nsName,
			Labels:    labels,
		},
		Spec: appsv1.DeploymentSpecArgs{
			Replicas: pulumi.Int(1),
			Strategy: appsv1.DeploymentStrategyArgs{Type: pulumi.String("Recreate")},
			Selector: metav1.LabelSelectorArgs{MatchLabels: selector},
			Template: corev1.PodTemplateSpecArgs{
				Metadata: metav1.ObjectMetaArgs{Labels: labels},
				Spec:     podSpec,
			},
		},
	}, opts...)
	if err != nil {
		return pulumi.StringOutput{}, err
	}

	// Service LoadBalancer : le pool Cilium LB-IPAM est choisi par le label du contrat.
	svcLabels := pulumi.ToStringMap(c.Labels)
	svcLabels[c.Policy.LBPoolLabel] = pulumi.String(c.Policy.LBPool)
	svcPorts := corev1.ServicePortArray{}
	for _, p := range c.Ports {
		svcPorts = append(svcPorts, corev1.ServicePortArgs{
			Name:       pulumi.String(p.Name()),
			Port:       pulumi.Int(p.Number),
			TargetPort: pulumi.Int(p.Number),
			Protocol:   pulumi.String(p.Protocol),
		})
	}
	svc, err := corev1.NewService(ctx, "service", &corev1.ServiceArgs{
		Metadata: metav1.ObjectMetaArgs{
			Name:      pulumi.String("instance"),
			Namespace: nsName,
			Labels:    svcLabels,
		},
		Spec: corev1.ServiceSpecArgs{
			Type:     pulumi.String("LoadBalancer"),
			Selector: selector,
			Ports:    svcPorts,
			// Local : préserve l'IP source (routing peer NetBird) pour que la NetworkPolicy
			// puisse la filtrer ; sans SNAT inter-nœuds.
			ExternalTrafficPolicy: pulumi.String("Local"),
		},
	}, opts...)
	if err != nil {
		return pulumi.StringOutput{}, err
	}

	// NetworkPolicy propre à l'instance : ingress depuis le routing peer NetBird uniquement, egress interdit (aucune
	// règle). Elle ne dépend pas de Kyverno : même si la `default-deny` générée tarde, l'instance ne peut rien joindre.
	// Nom distinct de `default-deny` (générée par Kyverno) pour éviter tout conflit de propriété.
	from := netv1.NetworkPolicyPeerArray{}
	for _, cidr := range c.Policy.FromCIDRs {
		from = append(from, netv1.NetworkPolicyPeerArgs{IpBlock: netv1.IPBlockArgs{Cidr: pulumi.String(cidr)}})
	}
	inPorts := netv1.NetworkPolicyPortArray{}
	for _, p := range c.Ports {
		inPorts = append(inPorts, netv1.NetworkPolicyPortArgs{
			Port:     pulumi.Int(p.Number),
			Protocol: pulumi.String(p.Protocol),
		})
	}
	_, err = netv1.NewNetworkPolicy(ctx, "netpol", &netv1.NetworkPolicyArgs{
		Metadata: metav1.ObjectMetaArgs{
			Name:      pulumi.String(NetworkPolicyName),
			Namespace: nsName,
			Labels:    labels,
		},
		Spec: netv1.NetworkPolicySpecArgs{
			PodSelector: metav1.LabelSelectorArgs{},
			PolicyTypes: pulumi.ToStringArray([]string{"Ingress", "Egress"}),
			Ingress: netv1.NetworkPolicyIngressRuleArray{
				netv1.NetworkPolicyIngressRuleArgs{From: from, Ports: inPorts},
			},
			Egress: netv1.NetworkPolicyEgressRuleArray{},
		},
	}, opts...)
	if err != nil {
		return pulumi.StringOutput{}, err
	}

	first := c.Ports[0].Number
	info := svc.Status.LoadBalancer().Ingress().ApplyT(func(in []corev1.LoadBalancerIngress) (string, error) {
		if len(in) == 0 || in[0].Ip == nil || *in[0].Ip == "" {
			return "", fmt.Errorf("aucune IP LoadBalancer allouée (pool %q épuisé ?)", c.Policy.LBPool)
		}
		return fmt.Sprintf("%s:%d", *in[0].Ip, first), nil
	}).(pulumi.StringOutput)
	return info, nil
}
