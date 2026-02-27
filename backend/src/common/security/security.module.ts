// ============================================================
// SecurityModule — L6 Cross-Cutting Security Services
//
// @Global() → EncryptionService và PasswordService injectable
// khắp nơi mà không cần import SecurityModule ở mỗi module.
//
// Import vào AppModule để activate (đặt sau DalModule và trước
// GatewayModule để logger sẵn sàng khi services khởi tạo).
// ============================================================
import { Global, Module } from '@nestjs/common';
import { EncryptionService } from './encryption.service';
import { PasswordService } from './password.service';

@Global()
@Module({
  providers: [EncryptionService, PasswordService],
  exports: [EncryptionService, PasswordService],
})
export class SecurityModule {}
