export type ServiceType = 'web' | 'private' | 'worker' | 'cron' | 'job';
export type SourceType = 'github' | 'gitlab' | 'zip' | 'image' | 'local';
export type BuildMode = 'auto' | 'dockerfile' | 'buildpack' | 'custom' | 'prebuilt-image';
export type ResourceEngine = 'postgresql' | 'mysql' | 'mariadb' | 'mongodb' | 'redis' | 'object-storage' | 'vector-db' | 'message-queue';

export interface OrganizationSpec {
  id: string;
  name: string;
  slug: string;
  plan: 'free' | 'club' | 'pro' | 'school' | 'enterprise';
}

export interface ServiceSpec {
  id: string;
  name: string;
  type: ServiceType;
  sourceType: SourceType;
  buildMode?: BuildMode;
  repoUrl?: string;
  branch?: string;
  rootDirectory?: string;
  buildContext?: string;
  dockerfilePath?: string;
  installCommand?: string;
  buildCommand?: string;
  startCommand?: string;
  image?: string;
  port?: number;
  domain?: string;
  schedule?: string;
  attachedResources: string[];
}

export interface ResourceSpec {
  id: string;
  name: string;
  type: 'database' | 'cache' | 'storage' | 'vector' | 'queue';
  engine: ResourceEngine;
  plan: string;
  region: string;
  storageGb?: number;
}

export interface ProjectSpec {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  description?: string;
  services: ServiceSpec[];
  resources: ResourceSpec[];
}

export interface DeploymentRequest {
  projectId: string;
  serviceId: string;
  commitSha?: string;
  deploymentType: 'production' | 'preview' | 'manual';
}
