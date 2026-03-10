import { PluginsModule } from '../plugins.module';
import { PluginDependencyService, GraphValidationIssue } from '../deps/plugin-dependency.service';

describe('PluginsModule.onModuleInit()', () => {
  let module: PluginsModule;
  let mockValidateGraph: ReturnType<typeof vi.fn>;
  let mockWarn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockValidateGraph = vi.fn();
    mockWarn = vi.fn();

    const mockDeps = { validateGraph: mockValidateGraph } as unknown as PluginDependencyService;
    module = new PluginsModule(mockDeps);

    // Spy on the NestJS Logger instance created inside the module
    vi.spyOn((module as any).logger, 'warn').mockImplementation(mockWarn);
  });

  it('logs a warning for each validation issue', () => {
    const issues: GraphValidationIssue[] = [
      { type: 'missing_dependency', plugin: 'a', detail: 'Plugin a depends on missing' },
      { type: 'circular_dependency', plugin: 'b', detail: 'Circular: b → b' },
    ];
    mockValidateGraph.mockReturnValue(issues);

    module.onModuleInit();

    expect(mockWarn).toHaveBeenCalledTimes(2);
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('[PluginDependency]'));
  });

  it('logs nothing when graph is valid', () => {
    mockValidateGraph.mockReturnValue([]);

    module.onModuleInit();

    expect(mockWarn).not.toHaveBeenCalled();
  });
});
