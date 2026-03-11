function resolvePath(path: string, ctx: Record<string, unknown>): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc !== null && typeof acc === 'object') {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, ctx);
}

export function resolveTemplate(
  template: string,
  ctx: Record<string, unknown>,
): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (match, path: string) => {
    const trimmed = path.trim();
    if (!trimmed) return match;
    const value = resolvePath(trimmed, ctx);
    if (value === undefined || value === null) return '';
    return String(value);
  });
}

export function resolveParams(
  params: Record<string, unknown>,
  ctx: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    result[key] = typeof value === 'string' ? resolveTemplate(value, ctx) : value;
  }
  return result;
}
