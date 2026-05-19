package controller

// DomainController reconciles Ingress/Gateway routes and TLS certificate status.
type DomainController struct{}

func (DomainController) Name() string { return "raibitserver-domain-controller" }
