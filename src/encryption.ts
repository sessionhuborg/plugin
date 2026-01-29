/**
 * Encryption module for E2E encrypted session data
 *
 * Uses hybrid encryption (AES-GCM + RSA-OAEP) to encrypt session content
 * before sending to the backend. Compatible with frontend decryption.
 *
 * Encryption flow:
 * 1. Generate random AES-256 key
 * 2. Encrypt content with AES-GCM
 * 3. Encrypt AES key with team/user public RSA key
 * 4. Return encrypted payload
 */

import * as crypto from 'crypto';
import { logger } from './logger.js';

const AES_KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12; // 96 bits for AES-GCM

export interface EncryptedPayload {
  encryptedContent: string; // Base64-encoded AES-GCM ciphertext
  encryptedKey: string;     // Base64-encoded RSA-OAEP encrypted AES key
  iv: string;               // Base64-encoded IV
  version: number;          // Encryption format version
}

/**
 * Import an RSA public key from Base64-encoded SPKI format
 */
async function importPublicKey(publicKeyBase64: string): Promise<crypto.KeyObject> {
  const keyBuffer = Buffer.from(publicKeyBase64, 'base64');

  // Convert SPKI DER to PEM format for Node.js crypto
  const pemHeader = '-----BEGIN PUBLIC KEY-----\n';
  const pemFooter = '\n-----END PUBLIC KEY-----';
  const pemKey = pemHeader + keyBuffer.toString('base64').match(/.{1,64}/g)!.join('\n') + pemFooter;

  return crypto.createPublicKey({
    key: pemKey,
    format: 'pem',
    type: 'spki',
  });
}

/**
 * Encrypt content using hybrid encryption
 *
 * @param plaintext The content to encrypt
 * @param publicKeyBase64 Base64-encoded SPKI public key
 * @returns Encrypted payload compatible with frontend decryption
 */
export async function encryptContent(
  plaintext: string,
  publicKeyBase64: string
): Promise<EncryptedPayload> {
  // Generate random AES key
  const aesKey = crypto.randomBytes(AES_KEY_LENGTH);

  // Generate random IV
  const iv = crypto.randomBytes(IV_LENGTH);

  // Encrypt content with AES-GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Combine ciphertext and auth tag (Web Crypto format)
  const encryptedContent = Buffer.concat([encrypted, authTag]);

  // Import and encrypt AES key with RSA-OAEP
  const publicKey = await importPublicKey(publicKeyBase64);
  const encryptedKey = crypto.publicEncrypt(
    {
      key: publicKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    aesKey
  );

  return {
    encryptedContent: encryptedContent.toString('base64'),
    encryptedKey: encryptedKey.toString('base64'),
    iv: iv.toString('base64'),
    version: 1,
  };
}

/**
 * Encrypt session fields that contain sensitive data
 *
 * @param data Session data object
 * @param publicKey Base64-encoded public key
 * @returns Object with encrypted fields and encryption metadata
 */
export async function encryptSessionFields(
  data: {
    interactions?: any[];
    todoSnapshots?: any[];
    plans?: any[];
    subSessions?: any[];
    attachmentUrls?: any[];
  },
  publicKey: string
): Promise<{
  encryptedInteractions?: string;
  encryptedTodoSnapshots?: string;
  encryptedPlans?: string;
  encryptedSubSessions?: string;
  encryptedAttachmentUrls?: string;
}> {
  const result: {
    encryptedInteractions?: string;
    encryptedTodoSnapshots?: string;
    encryptedPlans?: string;
    encryptedSubSessions?: string;
    encryptedAttachmentUrls?: string;
  } = {};

  // Encrypt interactions (most sensitive - contains full conversation)
  if (data.interactions && data.interactions.length > 0) {
    const payload = await encryptContent(JSON.stringify(data.interactions), publicKey);
    result.encryptedInteractions = JSON.stringify(payload);
  }

  // Encrypt todo snapshots
  if (data.todoSnapshots && data.todoSnapshots.length > 0) {
    const payload = await encryptContent(JSON.stringify(data.todoSnapshots), publicKey);
    result.encryptedTodoSnapshots = JSON.stringify(payload);
  }

  // Encrypt plans
  if (data.plans && data.plans.length > 0) {
    const payload = await encryptContent(JSON.stringify(data.plans), publicKey);
    result.encryptedPlans = JSON.stringify(payload);
  }

  // Encrypt sub-sessions
  if (data.subSessions && data.subSessions.length > 0) {
    const payload = await encryptContent(JSON.stringify(data.subSessions), publicKey);
    result.encryptedSubSessions = JSON.stringify(payload);
  }

  // Encrypt attachment URLs (contains file metadata)
  if (data.attachmentUrls && data.attachmentUrls.length > 0) {
    const payload = await encryptContent(JSON.stringify(data.attachmentUrls), publicKey);
    result.encryptedAttachmentUrls = JSON.stringify(payload);
  }

  return result;
}

/**
 * Check if a public key is valid for encryption
 */
export async function isValidPublicKey(publicKeyBase64: string): Promise<boolean> {
  if (!publicKeyBase64 || publicKeyBase64.length < 100) {
    return false;
  }

  try {
    await importPublicKey(publicKeyBase64);
    return true;
  } catch (error) {
    logger.warn('Invalid public key format:', error);
    return false;
  }
}
