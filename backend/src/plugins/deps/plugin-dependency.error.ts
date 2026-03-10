import { AppError } from '../../common/errors/app.error';

export class PluginDependencyError extends AppError {
  constructor(
    public readonly pluginName: string,
    public readonly action: 'enable' | 'disable',
    public readonly missingDeps: string[],
    public readonly blockingDependents: string[],
  ) {
    const detail =
      action === 'enable'
        ? `Cannot enable '${pluginName}': missing enabled dependencies: ${missingDeps.join(', ')}`
        : `Cannot disable '${pluginName}': required by enabled plugins: ${blockingDependents.join(', ')}`;
    super(detail, 422, 'PLUGIN_DEPENDENCY_VIOLATION');
  }
}
