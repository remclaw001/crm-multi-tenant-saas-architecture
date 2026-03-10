import { Inject, Injectable } from '@nestjs/common';
import { PluginManifest } from '../interfaces/plugin-manifest.interface';
import { PLUGIN_MANIFESTS } from './plugin-manifests.token';

export interface GraphValidationIssue {
  type: 'missing_dependency' | 'circular_dependency';
  plugin: string;
  detail: string;
}

@Injectable()
export class PluginDependencyService {
  private readonly index: Map<string, PluginManifest>;

  constructor(@Inject(PLUGIN_MANIFESTS) manifests: PluginManifest[]) {
    this.index = new Map(manifests.map((m) => [m.name, m]));
  }

  validateGraph(): GraphValidationIssue[] {
    const issues: GraphValidationIssue[] = [];

    // Pass 1: missing dependency check
    for (const [name, manifest] of this.index) {
      for (const dep of manifest.dependencies) {
        if (!this.index.has(dep)) {
          issues.push({
            type: 'missing_dependency',
            plugin: name,
            detail: `Plugin '${name}' depends on '${dep}' which is not registered`,
          });
        }
      }
    }

    // Pass 2: circular dependency detection (DFS with color marking)
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<string, number>(
      [...this.index.keys()].map((k) => [k, WHITE]),
    );

    const dfs = (node: string, path: string[]): void => {
      color.set(node, GRAY);
      const manifest = this.index.get(node);
      if (!manifest) return;

      const currentPath = [...path, node];

      for (const dep of manifest.dependencies) {
        if (!this.index.has(dep)) continue; // already caught in pass 1
        if (color.get(dep) === GRAY) {
          const cycleStart = currentPath.indexOf(dep);
          const cycle = cycleStart >= 0
            ? [...currentPath.slice(cycleStart), dep].join(' → ')
            : [...currentPath, dep].join(' → ');
          issues.push({
            type: 'circular_dependency',
            plugin: node,
            detail: `Circular dependency detected: ${cycle}`,
          });
        } else if (color.get(dep) === WHITE) {
          dfs(dep, currentPath);
        }
      }
      color.set(node, BLACK);
    };

    for (const name of this.index.keys()) {
      if (color.get(name) === WHITE) {
        dfs(name, []);
      }
    }

    return issues;
  }

  getMissingDeps(pluginName: string, enabledPlugins: string[]): string[] {
    const manifest = this.index.get(pluginName);
    if (!manifest) return [];
    const enabled = new Set(enabledPlugins);
    return manifest.dependencies.filter((dep) => !enabled.has(dep));
  }

  getBlockingDependents(pluginName: string, enabledPlugins: string[]): string[] {
    const enabled = new Set(enabledPlugins);
    return [...this.index.values()]
      .filter((m) => m.dependencies.includes(pluginName) && enabled.has(m.name))
      .map((m) => m.name);
  }
}
