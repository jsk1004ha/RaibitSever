export function organizationScopeFromProjectInput(projectInput: Record<string, any> = {}, subject: Record<string, any> = {}) {
  return projectInput.organizationId
    || projectInput.orgId
    || projectInput.organization?.id
    || projectInput.organization?.slug
    || projectInput.organizationSlug
    || subject.organizationId
    || 'default';
}

export function projectScopeFromInput(input: Record<string, any> = {}) {
  return input.projectId || input.project?.id || input.project?.slug || null;
}
