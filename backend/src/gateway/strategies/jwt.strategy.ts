// ============================================================
// JwtStrategy — Passport JWT strategy với JWKS support
//
// Hỗ trợ 2 chế độ:
//   Production: RS256 + JWKS endpoint (Keycloak)
//     → Set JWT_JWKS_URI + JWT_ISSUER trong .env
//
//   Dev/Test: HS256 + symmetric secret
//     → Set JWT_SECRET_FALLBACK trong .env (min 32 chars)
//
// Sau khi verify thành công, validate() được gọi với payload đã decode.
// Return value của validate() → req.user trong controllers.
//
// Thay thế cho @fastify/jwt + jwks-rsa plugin của thiết kế gốc.
// ============================================================
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';
import { config } from '../../config/env';
import type { JwtClaims } from '../dto/jwt-claims.dto';

function buildSecretOrKeyProvider() {
  // ── Production mode: JWKS (RS256) ─────────────────────────
  if (config.JWT_JWKS_URI) {
    return passportJwtSecret({
      cache: true,
      cacheMaxEntries: 5,
      cacheMaxAge: 10 * 60 * 1000,  // 10 phút
      rateLimit: true,
      jwksRequestsPerMinute: 5,
      jwksUri: config.JWT_JWKS_URI,
    });
  }

  // ── Dev/Test mode: symmetric secret (HS256) ──────────────
  // passportJwtSecret trả về SecretOrKeyProvider callback signature.
  // Với symmetric secret, ta trả về string trực tiếp.
  return config.JWT_SECRET_FALLBACK!;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    super({
      // Lấy JWT từ Authorization: Bearer <token>
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),

      // Reject expired tokens (không cần manual check)
      ignoreExpiration: false,

      // Algorithm phụ thuộc vào mode
      algorithms: config.JWT_JWKS_URI ? ['RS256'] : ['HS256'],

      // Issuer validation (optional — chỉ check khi set)
      ...(config.JWT_ISSUER ? { issuer: config.JWT_ISSUER } : {}),

      // Audience validation (optional)
      ...(config.JWT_AUDIENCE ? { audience: config.JWT_AUDIENCE } : {}),

      // JWKS mode: secretOrKeyProvider (callback); dev mode: secretOrKey (string)
      ...(config.JWT_JWKS_URI
        ? { secretOrKeyProvider: buildSecretOrKeyProvider() }
        : { secretOrKey: config.JWT_SECRET_FALLBACK }),
    });
  }

  /**
   * Gọi sau khi JWT đã được verify thành công.
   * Payload đã được decode — không cần verify lại signature.
   *
   * Return value trở thành req.user.
   * Throw UnauthorizedException nếu payload không hợp lệ.
   */
  async validate(payload: Record<string, unknown>): Promise<JwtClaims> {
    const sub = payload['sub'];
    const tenant_id = payload['tenant_id'];

    if (typeof sub !== 'string' || !sub) {
      throw new UnauthorizedException('JWT missing required claim: sub');
    }

    if (typeof tenant_id !== 'string' || !tenant_id) {
      throw new UnauthorizedException('JWT missing required claim: tenant_id');
    }

    return {
      sub,
      tenant_id,
      roles: Array.isArray(payload['roles']) ? (payload['roles'] as string[]) : [],
      email: typeof payload['email'] === 'string' ? payload['email'] : undefined,
      iat: payload['iat'] as number,
      exp: payload['exp'] as number,
    };
  }
}
