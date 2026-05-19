package kube

type AppServiceSpec struct {
    Name      string            `json:"name"`
    Namespace string            `json:"namespace"`
    Image     string            `json:"image"`
    Port      int               `json:"port"`
    Env       map[string]string `json:"env"`
}

type DeploymentPlan struct {
    Kind      string         `json:"kind"`
    Service   AppServiceSpec `json:"service"`
    Safe      bool           `json:"safe"`
    Reconcile string         `json:"reconcile"`
}

func NewDeploymentPlan(spec AppServiceSpec) DeploymentPlan {
    return DeploymentPlan{Kind: "Deployment", Service: spec, Safe: true, Reconcile: "apply-and-status-sync"}
}
