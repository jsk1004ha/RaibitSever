package kube

import (
	"encoding/json"
	"regexp"
	"strconv"
	"strings"

	"github.com/raibitserver/orchestrator/internal/store"
)

type AppServiceSpec struct {
	Name             string            `json:"name"`
	Namespace        string            `json:"namespace"`
	Image            string            `json:"image"`
	Port             int               `json:"port"`
	Replicas         int               `json:"replicas"`
	Host             string            `json:"host,omitempty"`
	Env              map[string]string `json:"env,omitempty"`
	ProjectSlug      string            `json:"projectSlug"`
	OrganizationSlug string            `json:"organizationSlug"`
	ServiceType      string            `json:"serviceType"`
	DeploymentID     string            `json:"deploymentId"`
}

type DeploymentPlan struct {
	Kind      string         `json:"kind"`
	Service   AppServiceSpec `json:"service"`
	Safe      bool           `json:"safe"`
	Reconcile string         `json:"reconcile"`
	Manifests []map[string]any `json:"manifests"`
}

func NewDeploymentPlan(spec AppServiceSpec) DeploymentPlan {
	if spec.Replicas <= 0 {
		spec.Replicas = 1
	}
	if spec.Port <= 0 {
		spec.Port = 3000
	}
	if spec.ServiceType == "" {
		spec.ServiceType = "web"
	}
	return DeploymentPlan{Kind: "Deployment", Service: spec, Safe: true, Reconcile: "apply-rollout-status-sync", Manifests: CompileServiceManifests(spec)}
}

func SpecFromState(project *store.Project, service *store.Service, deployment *store.Deployment, baseDomain string) AppServiceSpec {
	projectSlug := slug(firstNonEmpty(project.Slug, project.Name, project.ID, "project"))
	organizationSlug := slug(firstNonEmpty(project.OrganizationID, "org"))
	serviceName := slug(firstNonEmpty(service.Slug, service.Name, service.ID, "service"))
	domain := firstNonEmpty(baseDomain, service.BaseDomain, "apps.raibitserver.local")
	host := serviceName + "--" + projectSlug + "--" + organizationSlug + "." + domain
	if deployment.DeploymentType == "preview" && deployment.PullRequestNumber > 0 {
		host = "pr-" + strconv.Itoa(deployment.PullRequestNumber) + "--" + serviceName + "--" + projectSlug + "--" + organizationSlug + ".preview." + domain
	}
	return AppServiceSpec{Name: serviceName, Namespace: organizationSlug + "-" + projectSlug, Image: firstNonEmpty(deployment.ImageURL, service.ImageURL), Port: service.Port, Replicas: service.Replicas, Host: host, ProjectSlug: projectSlug, OrganizationSlug: organizationSlug, ServiceType: firstNonEmpty(service.Type, "web"), DeploymentID: deployment.ID}
}

func CompileServiceManifests(spec AppServiceSpec) []map[string]any {
	labels := map[string]any{"app.kubernetes.io/name": spec.Name, "app.kubernetes.io/managed-by": "raibitserver", "raibitserver.io/project": spec.ProjectSlug, "raibitserver.io/service": spec.Name, "raibitserver.io/deployment": spec.DeploymentID}
	items := []map[string]any{
		{"apiVersion": "v1", "kind": "Namespace", "metadata": map[string]any{"name": spec.Namespace, "labels": map[string]any{"raibitserver.io/project": spec.ProjectSlug, "pod-security.kubernetes.io/enforce": "restricted"}}},
		deploymentManifest(spec, labels),
		serviceManifest(spec, labels),
		networkPolicyManifest(spec, labels),
	}
	if strings.EqualFold(spec.ServiceType, "web") && spec.Host != "" {
		items = append(items, ingressManifest(spec, labels))
	}
	return items
}

func List(manifests []map[string]any) map[string]any {
	return map[string]any{"apiVersion": "v1", "kind": "List", "items": manifests}
}

func ListJSON(manifests []map[string]any) ([]byte, error) {
	return json.MarshalIndent(List(manifests), "", "  ")
}

func deploymentManifest(spec AppServiceSpec, labels map[string]any) map[string]any {
	return map[string]any{"apiVersion": "apps/v1", "kind": "Deployment", "metadata": map[string]any{"name": spec.Name, "namespace": spec.Namespace, "labels": labels}, "spec": map[string]any{"replicas": spec.Replicas, "selector": map[string]any{"matchLabels": map[string]any{"app.kubernetes.io/name": spec.Name}}, "strategy": map[string]any{"type": "RollingUpdate", "rollingUpdate": map[string]any{"maxUnavailable": 0, "maxSurge": 1}}, "template": map[string]any{"metadata": map[string]any{"labels": labels}, "spec": map[string]any{"securityContext": map[string]any{"runAsNonRoot": true, "seccompProfile": map[string]any{"type": "RuntimeDefault"}}, "automountServiceAccountToken": false, "containers": []any{map[string]any{"name": spec.Name, "image": spec.Image, "imagePullPolicy": "IfNotPresent", "ports": []any{map[string]any{"name": "http", "containerPort": spec.Port}}, "resources": map[string]any{"requests": map[string]any{"cpu": "100m", "memory": "128Mi"}, "limits": map[string]any{"cpu": "500m", "memory": "512Mi"}}, "securityContext": map[string]any{"allowPrivilegeEscalation": false, "readOnlyRootFilesystem": true, "runAsNonRoot": true, "capabilities": map[string]any{"drop": []any{"ALL"}}}, "volumeMounts": []any{map[string]any{"name": "tmp", "mountPath": "/tmp"}}}}, "volumes": []any{map[string]any{"name": "tmp", "emptyDir": map[string]any{}}}}}}}
}

func serviceManifest(spec AppServiceSpec, labels map[string]any) map[string]any {
	return map[string]any{"apiVersion": "v1", "kind": "Service", "metadata": map[string]any{"name": spec.Name, "namespace": spec.Namespace, "labels": labels}, "spec": map[string]any{"type": "ClusterIP", "selector": map[string]any{"app.kubernetes.io/name": spec.Name}, "ports": []any{map[string]any{"name": "http", "port": spec.Port, "targetPort": "http"}}}}
}

func ingressManifest(spec AppServiceSpec, labels map[string]any) map[string]any {
	return map[string]any{"apiVersion": "networking.k8s.io/v1", "kind": "Ingress", "metadata": map[string]any{"name": spec.Name, "namespace": spec.Namespace, "labels": labels, "annotations": map[string]any{"raibitserver.io/hostname": spec.Host}}, "spec": map[string]any{"rules": []any{map[string]any{"host": spec.Host, "http": map[string]any{"paths": []any{map[string]any{"path": "/", "pathType": "Prefix", "backend": map[string]any{"service": map[string]any{"name": spec.Name, "port": map[string]any{"number": spec.Port}}}}}}}}}}
}

func networkPolicyManifest(spec AppServiceSpec, labels map[string]any) map[string]any {
	return map[string]any{"apiVersion": "networking.k8s.io/v1", "kind": "NetworkPolicy", "metadata": map[string]any{"name": spec.Name + "-default", "namespace": spec.Namespace, "labels": labels}, "spec": map[string]any{"podSelector": map[string]any{"matchLabels": map[string]any{"app.kubernetes.io/name": spec.Name}}, "policyTypes": []any{"Ingress", "Egress"}, "ingress": []any{map[string]any{"from": []any{map[string]any{"namespaceSelector": map[string]any{}}}}}, "egress": []any{map[string]any{"to": []any{map[string]any{"namespaceSelector": map[string]any{}}}}}}}
}

var slugPattern = regexp.MustCompile(`[^a-z0-9._-]+`)

func slug(value string) string {
	out := strings.ToLower(strings.TrimSpace(value))
	out = slugPattern.ReplaceAllString(out, "-")
	out = strings.Trim(out, "-._")
	if out == "" {
		return "item"
	}
	return out
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
