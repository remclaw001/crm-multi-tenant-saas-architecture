// ============================================================
// EncryptionService — AES-256-GCM PII field encryption
//
// Dùng để mã hóa PII fields (email, phone, address) trước khi
// lưu vào DB. Plain text không bao giờ persist vào storage.
//
// Ciphertext format (colon-separated base64):
//   "<iv_b64>:<authTag_b64>:<ciphertext_b64>"
//   - IV:       12 random bytes (96 bits) — recommended for GCM
//   - AuthTag:  16 bytes — GCM integrity verification
//   - Payload:  encrypted UTF-8 plaintext
//
// Key: ENCRYPTION_KEY env (64 hex chars = 32 bytes = AES-256)
//
// GCM mode provides:
//   - Confidentiality (AES-CTR)
//   - Integrity + Authenticity (GHASH auth tag)
//   → Tampered ciphertext throws on decrypt (not silently corrupts)
// ============================================================
import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { config } from '../../config/env';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;   // 96-bit IV — NIST recommendation for GCM
const TAG_BYTES = 16;  // 128-bit auth tag

@Injectable()
export class EncryptionService {
  private readonly key: Buffer;

  constructor() {
    this.key = Buffer.from(config.ENCRYPTION_KEY, 'hex');
    if (this.key.length !== 32) {
      throw new Error('ENCRYPTION_KEY must decode to exactly 32 bytes (64 hex chars)');
    }
  }

  /**
   * Encrypt plaintext PII value.
   * Returns colon-separated base64: "iv:authTag:ciphertext"
   */
  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv, {
      authTagLength: TAG_BYTES,
    });

    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return [
      iv.toString('base64'),
      authTag.toString('base64'),
      encrypted.toString('base64'),
    ].join(':');
  }

  /**
   * Decrypt ciphertext produced by encrypt().
   * Throws if GCM authentication tag fails (tampered/corrupted data).
   */
  decrypt(ciphertext: string): string {
    const parts = ciphertext.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid ciphertext format: expected "iv:authTag:ciphertext"');
    }

    const [ivB64, authTagB64, encB64] = parts;
    const iv      = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(authTagB64, 'base64');
    const enc     = Buffer.from(encB64, 'base64');

    const decipher = crypto.createDecipheriv(ALGORITHM, this.key, iv, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(enc),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  }
}
