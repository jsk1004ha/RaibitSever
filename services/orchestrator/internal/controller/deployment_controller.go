package controller

// DeploymentController tracks rollout status and writes deployment health back to the control-plane DB.
type DeploymentController struct{}

func (DeploymentController) Name() string { return "raibitserver-deployment-controller" }
