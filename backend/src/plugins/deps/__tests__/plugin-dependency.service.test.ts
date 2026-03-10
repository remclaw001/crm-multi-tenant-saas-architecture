import { PluginDependencyService } from '../plugin-dependency.service';
import { PluginManifest } from '../../interfaces/plugin-manifest.interface';
import { BUILT_IN_MANIFESTS } from '../../manifest/built-in-manifests';

const makeManifest = (name: string, deps: string[] = []): PluginManifest => ({
  name,
  version: '1.0.0',
  description: '',
  dependencies: deps,
  permissions: [],
  limits: { timeoutMs: 5000, memoryMb: 50, maxQueries: 50 },
  hooks: [],
});

const make = (manifests: PluginManifest[]) => new PluginDependencyService(manifests);

describe('PluginDependencyService', () => {
  describe('validateGraph()', () => {
    it('returns no issues for a valid graph', () => {
      const svc = make([
        makeManifest('a'),
        makeManifest('b', ['a']),
        makeManifest('c', ['a', 'b']),
      ]);
      expect(svc.validateGraph()).toEqual([]);
    });

    it('returns missing_dependency issue when dep is not registered', () => {
      const svc = make([makeManifest('a', ['nonexistent'])]);
      const issues = svc.validateGraph();
      expect(issues).toHaveLength(1);
      expect(issues[0].type).toBe('missing_dependency');
      expect(issues[0].plugin).toBe('a');
      expect(issues[0].detail).toContain('nonexistent');
    });

    it('returns circular_dependency issue for A→B→A', () => {
      const svc = make([
        makeManifest('a', ['b']),
        makeManifest('b', ['a']),
      ]);
      const issues = svc.validateGraph();
      const circular = issues.filter((i) => i.type === 'circular_dependency');
      expect(circular.length).toBeGreaterThan(0);
      expect(circular[0].detail).toContain('→');
    });

    it('returns circular_dependency for self-reference A→A', () => {
      const svc = make([makeManifest('a', ['a'])]);
      const issues = svc.validateGraph();
      const circular = issues.filter((i) => i.type === 'circular_dependency');
      expect(circular.length).toBeGreaterThan(0);
      expect(circular[0].detail).toContain('a');
    });

    it('returns no issues for built-in manifests (sanity check)', () => {
      const svc = make(BUILT_IN_MANIFESTS);
      expect(svc.validateGraph()).toEqual([]);
    });
  });

  describe('getMissingDeps()', () => {
    it('returns empty array when all deps are enabled', () => {
      const svc = make([makeManifest('care', ['data']), makeManifest('data')]);
      expect(svc.getMissingDeps('care', ['data'])).toEqual([]);
    });

    it('returns missing dep names when some deps are not enabled', () => {
      const svc = make([makeManifest('care', ['data'])]);
      expect(svc.getMissingDeps('care', [])).toEqual(['data']);
    });

    it('returns empty array for unknown plugin name', () => {
      const svc = make([makeManifest('data')]);
      expect(svc.getMissingDeps('unknown', [])).toEqual([]);
    });

    it('returns empty array for a plugin with no dependencies', () => {
      const svc = make([makeManifest('data')]);
      expect(svc.getMissingDeps('data', [])).toEqual([]);
    });
  });

  describe('getBlockingDependents()', () => {
    it('returns empty array when no enabled plugin depends on target', () => {
      const svc = make([makeManifest('care', ['data']), makeManifest('data')]);
      expect(svc.getBlockingDependents('data', [])).toEqual([]);
    });

    it('returns enabled dependents when they depend on target', () => {
      const svc = make([makeManifest('care', ['data']), makeManifest('data')]);
      const blocking = svc.getBlockingDependents('data', ['care']);
      expect(blocking).toEqual(['care']);
    });

    it('returns only ENABLED dependents, not disabled ones', () => {
      const svc = make([
        makeManifest('care', ['data']),
        makeManifest('marketing', ['data']),
        makeManifest('data'),
      ]);
      const blocking = svc.getBlockingDependents('data', ['marketing']);
      expect(blocking).toEqual(['marketing']);
    });

    it('returns multiple enabled dependents', () => {
      const svc = make([
        makeManifest('care', ['data']),
        makeManifest('marketing', ['data']),
        makeManifest('automation', ['data', 'analytics']),
        makeManifest('data'),
        makeManifest('analytics'),
      ]);
      const blocking = svc.getBlockingDependents('data', ['care', 'marketing', 'automation']);
      expect(blocking).toContain('care');
      expect(blocking).toContain('marketing');
      expect(blocking).toContain('automation');
      expect(blocking).toHaveLength(3);
    });

    it('returns empty array for unknown plugin name', () => {
      const svc = make([makeManifest('data')]);
      expect(svc.getBlockingDependents('unknown', ['data'])).toEqual([]);
    });
  });
});
