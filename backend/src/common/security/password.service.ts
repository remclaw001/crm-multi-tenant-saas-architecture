// ============================================================
// PasswordService — bcrypt password hashing
//
// Cost factor 12 → ~250ms per hash on modern hardware.
// Per-hash random salt ngăn rainbow table attacks.
// bcrypt.compare() dùng constant-time comparison — không
// vulnerable với timing attacks.
//
// Dùng khi:
//   - User đăng ký: hash(password) → lưu password_hash vào DB
//   - User đăng nhập: verify(password, storedHash) → boolean
// ============================================================
import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

const SALT_ROUNDS = 12;

@Injectable()
export class PasswordService {
  /**
   * Hash plaintext password.
   * bcrypt generates a unique random salt per call — never reuse hashes.
   */
  async hash(password: string): Promise<string> {
    return bcrypt.hash(password, SALT_ROUNDS);
  }

  /**
   * Verify plaintext against a stored bcrypt hash.
   * Returns true if password matches, false otherwise.
   * Uses constant-time comparison internally.
   */
  async verify(password: string, storedHash: string): Promise<boolean> {
    return bcrypt.compare(password, storedHash);
  }
}
