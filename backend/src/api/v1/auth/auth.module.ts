import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { config } from '../../../config/env';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [
    JwtModule.register({
      secret: config.JWT_SECRET_FALLBACK ?? (() => {
        throw new Error('JWT_SECRET_FALLBACK is required for POST /auth/login. Set it in .env (min 32 chars).');
      })(),
      signOptions: { expiresIn: '24h', algorithm: 'HS256' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
