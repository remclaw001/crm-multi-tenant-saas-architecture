// ============================================================
// IPluginCore — base interface for all plugin cores
//
// Every plugin core must implement this interface.
// The manifest provides static metadata used by the registry.
// ============================================================
import type { PluginManifest } from './plugin-manifest.interface';

export interface IPluginCore {
  readonly manifest: PluginManifest;
}
