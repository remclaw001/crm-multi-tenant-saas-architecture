// ============================================================
// PasswordService Tests — bcrypt password hashing
//
// Note: bcrypt is intentionally slow (cost 12).
// Tests use the actual bcrypt implementation — no mocking.
// Test timeout is set high enough to accommodate hashing time.
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { PasswordService } from '../password.service';

describe('PasswordService', () => {
  let svc: PasswordService;

  beforeEach(() => {
    svc = new PasswordService();
  });

  it('hash() returns a bcrypt hash string', async () => {
    const hash = await svc.hash('myPassword123');
    // bcrypt hashes start with $2b$ (cost factor format)
    expect(hash).toMatch(/^\$2[ab]\$12\$/);
  }, 15_000);

  it('hash() produces different hashes for the same input (unique salt)', async () => {
    const [h1, h2] = await Promise.all([
      svc.hash('samePassword'),
      svc.hash('samePassword'),
    ]);
    expect(h1).not.toBe(h2);
  }, 30_000);

  it('verify() returns true for correct password', async () => {
    const hash = await svc.hash('correctPassword');
    const result = await svc.verify('correctPassword', hash);
    expect(result).toBe(true);
  }, 30_000);

  it('verify() returns false for wrong password', async () => {
    const hash = await svc.hash('correctPassword');
    const result = await svc.verify('wrongPassword', hash);
    expect(result).toBe(false);
  }, 30_000);

  it('verify() returns false for empty string against non-empty hash', async () => {
    const hash = await svc.hash('password');
    expect(await svc.verify('', hash)).toBe(false);
  }, 15_000);

  it('verify() handles special characters and unicode passwords', async () => {
    const pw = 'Mật!Khẩu@Phức#Tạp$123';
    const hash = await svc.hash(pw);
    expect(await svc.verify(pw, hash)).toBe(true);
    expect(await svc.verify('wrong', hash)).toBe(false);
  }, 30_000);
}, );
