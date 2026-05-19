package controller

// ResourceController coordinates app-to-resource attachment state with the provisioner.
type ResourceController struct{}

func (ResourceController) Name() string { return "raibitserver-resource-controller" }
