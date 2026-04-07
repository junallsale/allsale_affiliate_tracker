/**
 * Email template rendering — variable substitution
 */

/** Replace {{variable}} placeholders with values */
export function renderTemplate(
  template: string,
  variables: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] || '');
}
