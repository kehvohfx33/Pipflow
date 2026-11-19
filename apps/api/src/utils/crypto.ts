import crypto from 'crypto';
import { env } from '../config/env';

function getKeyBuffer(): Buffer {
  const raw = env.tokenEncryptionKey.trim();
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  const source = raw || env.jwtSecret;
  return crypto.createHash('sha256').update(source).digest();
}

export function encryptToken(plainToken: string): { encrypted: string; iv: string; authTag: string } {
  const keyBuffer = getKeyBuffer();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer, iv);
  const encrypted = Buffer.concat([cipher.update(plainToken, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    encrypted: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64')
  };
}

export function decryptToken(encrypted: string, iv: string, authTag: string): string {
  const keyBuffer = getKeyBuffer();
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64')),
    decipher.final()
  ]);
  return decrypted.toString('utf8');
}
