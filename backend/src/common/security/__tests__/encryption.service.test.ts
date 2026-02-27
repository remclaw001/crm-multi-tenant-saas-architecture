// ============================================================
// EncryptionService Tests — AES-256-GCM PII encryption
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { EncryptionService } from '../encryption.service';

describe('EncryptionService', () => {
  let svc: EncryptionService;

  beforeEach(() => {
    // env.ts default dev key is 64 hex zeros — sufficient for tests
    svc = new EncryptionService();
  });

  it('encrypts and decrypts a plaintext string correctly', () => {
    const plaintext = 'user@example.com';
    const ciphertext = svc.encrypt(plaintext);
    expect(svc.decrypt(ciphertext)).toBe(plaintext);
  });

  it('produces different ciphertext each call (random IV)', () => {
    const pt = 'same-input';
    const c1 = svc.encrypt(pt);
    const c2 = svc.encrypt(pt);
    // Same plaintext → different ciphertext due to random IV
    expect(c1).not.toBe(c2);
    // But both decrypt to the same value
    expect(svc.decrypt(c1)).toBe(pt);
    expect(svc.decrypt(c2)).toBe(pt);
  });

  it('ciphertext has the expected iv:authTag:data format', () => {
    const ciphertext = svc.encrypt('hello');
    const parts = ciphertext.split(':');
    expect(parts).toHaveLength(3);
    // iv: 12 bytes → base64 length = ceil(12 * 4/3) = 16 chars
    expect(Buffer.from(parts[0], 'base64').length).toBe(12);
    // authTag: 16 bytes → base64 length = ceil(16 * 4/3) = 24 chars
    expect(Buffer.from(parts[1], 'base64').length).toBe(16);
  });

  it('encrypts and decrypts Unicode + special characters', () => {
    const values = [
      'Nguyễn Văn Anh',
      '+1 (555) 123-4567',
      '123 Main St, Apt #4B, São Paulo',
      '{"nested": "json", "value": 42}',
    ];
    for (const v of values) {
      expect(svc.decrypt(svc.encrypt(v))).toBe(v);
    }
  });

  it('throws on tampered ciphertext (GCM auth tag fails)', () => {
    const ciphertext = svc.encrypt('sensitive data');
    const [iv, tag, data] = ciphertext.split(':');
    // Tamper with ciphertext bytes
    const tamperedData = Buffer.from(data, 'base64');
    tamperedData[0] ^= 0xff; // flip bits
    const tampered = `${iv}:${tag}:${tamperedData.toString('base64')}`;

    expect(() => svc.decrypt(tampered)).toThrow();
  });

  it('throws on malformed ciphertext', () => {
    expect(() => svc.decrypt('notvalidformat')).toThrow(
      'Invalid ciphertext format',
    );
    expect(() => svc.decrypt('a:b')).toThrow('Invalid ciphertext format');
  });

  it('handles empty string encryption', () => {
    expect(svc.decrypt(svc.encrypt(''))).toBe('');
  });

  it('handles long string encryption', () => {
    const longStr = 'a'.repeat(10_000);
    expect(svc.decrypt(svc.encrypt(longStr))).toBe(longStr);
  });
});
