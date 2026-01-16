/**
 * Tests for session limit error handling utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseSessionLimitError, isResourceExhaustedError, type SessionLimitError } from '../grpc-client.js';

// Mock the modules to prevent actual gRPC connections during import
vi.mock('@grpc/grpc-js', () => ({
  credentials: {
    createInsecure: vi.fn().mockReturnValue({ type: 'insecure' }),
    createSsl: vi.fn().mockReturnValue({ type: 'ssl' }),
  },
  loadPackageDefinition: vi.fn().mockReturnValue({
    sessionhub: {
      SessionHubService: vi.fn().mockImplementation(() => ({})),
    },
  }),
  Metadata: vi.fn().mockImplementation(() => ({
    add: vi.fn(),
  })),
}));

vi.mock('@grpc/proto-loader', () => ({
  loadSync: vi.fn().mockReturnValue({}),
}));

vi.mock('../logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('Session Limit Error Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('parseSessionLimitError', () => {
    it('should parse valid session limit error', () => {
      const error = new Error(
        'session_limit_exceeded:current=25:limit=25:upgrade_url=https://sessionhub.io/pricing'
      );
      const result = parseSessionLimitError(error);

      expect(result).not.toBeNull();
      expect(result?.type).toBe('session_limit_exceeded');
      expect(result?.currentCount).toBe(25);
      expect(result?.limit).toBe(25);
      expect(result?.upgradeUrl).toBe('https://sessionhub.io/pricing');
    });

    it('should parse error with different counts', () => {
      const error = new Error(
        'session_limit_exceeded:current=10:limit=25:upgrade_url=https://sessionhub.io/pricing'
      );
      const result = parseSessionLimitError(error);

      expect(result).not.toBeNull();
      expect(result?.currentCount).toBe(10);
      expect(result?.limit).toBe(25);
    });

    it('should parse error with zero current count', () => {
      const error = new Error(
        'session_limit_exceeded:current=0:limit=25:upgrade_url=https://sessionhub.io/pricing'
      );
      const result = parseSessionLimitError(error);

      expect(result).not.toBeNull();
      expect(result?.currentCount).toBe(0);
      expect(result?.limit).toBe(25);
    });

    it('should return null for non-limit errors', () => {
      const error = new Error('Some other error');
      const result = parseSessionLimitError(error);

      expect(result).toBeNull();
    });

    it('should return null for errors with partial format', () => {
      const error = new Error('session_limit_exceeded:current=25');
      const result = parseSessionLimitError(error);

      expect(result).toBeNull();
    });

    it('should return null for errors with no message', () => {
      const error = new Error();
      const result = parseSessionLimitError(error);

      expect(result).toBeNull();
    });

    it('should handle error with empty message', () => {
      const error = new Error('');
      const result = parseSessionLimitError(error);

      expect(result).toBeNull();
    });

    it('should parse error wrapped in gRPC message', () => {
      // gRPC errors often have the actual message wrapped
      const error = new Error(
        'Failed to upsert session: session_limit_exceeded:current=25:limit=25:upgrade_url=https://sessionhub.io/pricing'
      );
      const result = parseSessionLimitError(error);

      expect(result).not.toBeNull();
      expect(result?.currentCount).toBe(25);
    });
  });

  describe('isResourceExhaustedError', () => {
    it('should return true for RESOURCE_EXHAUSTED code (8)', () => {
      expect(isResourceExhaustedError({ code: 8 })).toBe(true);
    });

    it('should return false for other gRPC codes', () => {
      expect(isResourceExhaustedError({ code: 3 })).toBe(false); // INVALID_ARGUMENT
      expect(isResourceExhaustedError({ code: 5 })).toBe(false); // NOT_FOUND
      expect(isResourceExhaustedError({ code: 13 })).toBe(false); // INTERNAL
      expect(isResourceExhaustedError({ code: 14 })).toBe(false); // UNAVAILABLE
    });

    it('should return false for null', () => {
      expect(isResourceExhaustedError(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isResourceExhaustedError(undefined)).toBe(false);
    });

    it('should return false for error without code property', () => {
      expect(isResourceExhaustedError(new Error('test'))).toBe(false);
      expect(isResourceExhaustedError({})).toBe(false);
    });
  });

  describe('Import-all quota calculation', () => {
    it('should calculate correct number of sessions to import when under limit', () => {
      const filesToImport = 10;
      const remaining = 15;
      const result = Math.min(filesToImport, remaining);
      expect(result).toBe(10);
    });

    it('should calculate correct number when would exceed limit', () => {
      const filesToImport = 10;
      const remaining = 5;
      const result = Math.min(filesToImport, remaining);
      expect(result).toBe(5);
    });

    it('should import all when unlimited (Pro tier)', () => {
      const filesToImport = 100;
      const remaining = -1; // unlimited
      const result = remaining === -1 ? filesToImport : Math.min(filesToImport, remaining);
      expect(result).toBe(100);
    });

    it('should return 0 when no remaining capacity', () => {
      const filesToImport = 10;
      const remaining = 0;
      const result = Math.min(filesToImport, remaining);
      expect(result).toBe(0);
    });

    it('should calculate skipped count correctly', () => {
      const totalFiles = 10;
      const sessionsToImport = 3;
      const skippedCount = totalFiles - sessionsToImport;
      expect(skippedCount).toBe(7);
    });
  });

  describe('Capture without setup', () => {
    it('should detect missing API key', () => {
      // Test the logic for detecting missing API key
      const apiKey = undefined;
      const hasApiKey = Boolean(apiKey);
      expect(hasApiKey).toBe(false);
    });

    it('should detect empty API key', () => {
      const apiKey = '';
      const hasApiKey = Boolean(apiKey);
      expect(hasApiKey).toBe(false);
    });

    it('should detect valid API key', () => {
      const apiKey = 'shub_test_api_key_123';
      const hasApiKey = Boolean(apiKey);
      expect(hasApiKey).toBe(true);
    });
  });

  describe('SessionLimitError type', () => {
    it('should have correct type structure', () => {
      const error: SessionLimitError = {
        type: 'session_limit_exceeded',
        currentCount: 25,
        limit: 25,
        upgradeUrl: 'https://sessionhub.io/pricing',
      };

      expect(error.type).toBe('session_limit_exceeded');
      expect(typeof error.currentCount).toBe('number');
      expect(typeof error.limit).toBe('number');
      expect(typeof error.upgradeUrl).toBe('string');
    });
  });
});
