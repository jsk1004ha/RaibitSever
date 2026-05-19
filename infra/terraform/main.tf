terraform {
  required_version = ">= 1.6.0"
}

variable "environment" {
  description = "RAIBITSERVER environment name"
  type        = string
  default     = "local"
}

variable "region" {
  description = "Primary region for control-plane and runtime resources"
  type        = string
  default     = "ap-northeast-2"
}

locals {
  name = "raibitserver-${var.environment}"
}

output "control_plane_name" {
  value = local.name
}

output "expected_components" {
  value = [
    "postgresql-control-plane-db",
    "redis-workflow-cache",
    "kubernetes-runtime-cluster",
    "container-registry",
    "object-storage",
    "dns-zone",
  ]
}
