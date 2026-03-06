import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import type { JwtClaims } from '../../../gateway/dto/jwt-claims.dto';

@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ user?: JwtClaims }>();
    if (!req.user) {
      throw new UnauthorizedException('Authentication required');
    }
    if (!req.user.roles?.includes('super_admin')) {
      throw new ForbiddenException('Super admin access required');
    }
    return true;
  }
}
