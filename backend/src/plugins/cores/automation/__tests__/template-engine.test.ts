import { describe, it, expect } from 'vitest';
import { resolveTemplate, resolveParams } from '../template-engine';

describe('resolveTemplate', () => {
  it('replaces {{dot.path}} with value from context', () => {
    const result = resolveTemplate('Hello {{customer.name}}!', { customer: { name: 'Alice' } });
    expect(result).toBe('Hello Alice!');
  });

  it('returns empty string when path not found', () => {
    const result = resolveTemplate('Hi {{customer.missing}}', { customer: {} });
    expect(result).toBe('Hi ');
  });

  it('handles nested paths', () => {
    const result = resolveTemplate('{{a.b.c}}', { a: { b: { c: 'deep' } } });
    expect(result).toBe('deep');
  });

  it('returns non-string values as string', () => {
    const result = resolveTemplate('{{x}}', { x: 42 });
    expect(result).toBe('42');
  });

  it('ignores unknown syntax gracefully', () => {
    const result = resolveTemplate('{{}}', {});
    expect(result).toBe('{{}}');
  });
});

describe('resolveParams', () => {
  it('recursively resolves all string values in params object', () => {
    const params = { title: 'New case for {{customer.name}}', priority: 'high' };
    const ctx = { customer: { name: 'Bob' } };
    expect(resolveParams(params, ctx)).toEqual({
      title: 'New case for Bob',
      priority: 'high',
    });
  });

  it('does not recurse into non-string values', () => {
    const params = { count: 5, active: true };
    expect(resolveParams(params, {})).toEqual({ count: 5, active: true });
  });
});
