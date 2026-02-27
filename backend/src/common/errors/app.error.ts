// ============================================================
// AppError — Base error class cho toàn bộ application (L6)
//
// Error hierarchy:
//   AppError (base)
//     ├── DomainError    — business logic violations (4xx)
//     ├── PluginError    — plugin execution failures (5xx)
//     └── ValidationError — input validation failures (400)
//
// Mỗi subclass phải đặt:
//   - statusCode: HTTP status code tương ứng
//   - code: machine-readable error identifier (e.g. 'TENANT_NOT_FOUND')
//
// HttpExceptionFilter tự động detect AppError và map sang
// RFC 7807 Problem Details JSON với đầy đủ thông tin.
// ============================================================

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(message: string, statusCode: number, code: string) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    // Fix prototype chain — bắt buộc khi extend built-in classes trong TypeScript
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
