export const statusTone = {
  Live: 'green',
  Sleeping: 'slate',
  Failed: 'red',
  Building: 'blue',
} as const;

export function formatResourceSummary(input: { services: number; resources: number }) {
  return `${input.services} services · ${input.resources} resources`;
}
