// ============================================================
// PluginError — Plugin execution failure errors
//
// Subclass của AppError. Dùng cho các lỗi xảy ra trong
// plugin sandbox:
//   - Timeout (504 Gateway Timeout)
//   - Query limit exceeded (429 Too Many Requests)
//   - Plugin không tìm thấy (404)
//   - Execution error (502 Bad Gateway)
// ============================================================
import { AppError } from './app.error';

// ── Base PluginError ────────────────────────────────────────
export class PluginError extends AppError {
  readonly pluginName: string;

  constructor(
    message: string,
    statusCode: number,
    code: string,
    pluginName: string,
  ) {
    super(message, statusCode, code);
    this.pluginName = pluginName;
  }
}

// ── Specific plugin errors ──────────────────────────────────

export class PluginTimeoutError extends PluginError {
  constructor(pluginName: string, timeoutMs: number) {
    super(
      `Plugin '${pluginName}' timed out after ${timeoutMs}ms`,
      504,
      'PLUGIN_TIMEOUT',
      pluginName,
    );
  }
}

export class PluginQueryLimitError extends PluginError {
  constructor(pluginName: string, limit: number) {
    super(
      `Plugin '${pluginName}' exceeded query limit of ${limit}`,
      429,
      'PLUGIN_QUERY_LIMIT',
      pluginName,
    );
  }
}

export class PluginNotFoundError extends PluginError {
  constructor(pluginName: string) {
    super(
      `Plugin not found: '${pluginName}'`,
      404,
      'PLUGIN_NOT_FOUND',
      pluginName,
    );
  }
}

export class PluginExecutionError extends PluginError {
  constructor(pluginName: string, cause: string) {
    super(
      `Plugin '${pluginName}' execution failed: ${cause}`,
      502,
      'PLUGIN_EXECUTION_ERROR',
      pluginName,
    );
  }
}
