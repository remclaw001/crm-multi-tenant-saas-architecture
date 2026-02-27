// ============================================================
// ValidationError — Input validation failure error
//
// Subclass của AppError, status 400 Bad Request.
// Có thể kèm theo map fields → messages để client hiển thị
// inline validation errors.
//
// Khác với NestJS ValidationPipe (class-validator):
//   ValidationPipe throw BadRequestException với array messages.
//   ValidationError dùng trong business logic tự validate.
// ============================================================
import { AppError } from './app.error';

export class ValidationError extends AppError {
  /** Map field name → list of validation messages */
  readonly fields?: Readonly<Record<string, string[]>>;

  constructor(message: string, fields?: Record<string, string[]>) {
    super(message, 400, 'VALIDATION_ERROR');
    if (fields) {
      this.fields = fields;
    }
  }
}
