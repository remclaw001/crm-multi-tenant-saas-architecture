// ============================================================
// @Public() — decorator đánh dấu route không cần JWT
//
// Usage:
//   @Get('/health')
//   @Public()
//   healthCheck() { ... }
//
// JwtAuthGuard kiểm tra metadata này trước khi gọi super.canActivate()
// ============================================================
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Đánh dấu route là public — bỏ qua JWT verification */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
