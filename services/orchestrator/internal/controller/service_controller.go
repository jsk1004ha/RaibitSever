package controller

// ServiceController owns the desired-state to actual-state loop for app workloads.
type ServiceController struct{}

func (ServiceController) Name() string { return "raibitserver-service-controller" }
