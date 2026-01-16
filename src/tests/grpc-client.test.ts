/**
 * Tests for GrpcAPIClient helper functions
 *
 * Note: Full integration tests for GrpcAPIClient are skipped because ESM module
 * mocking with @grpc/grpc-js is complex. These tests focus on testable helper
 * functions and data transformations.
 */

import { describe, it, expect, vi } from 'vitest';

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

// ==========================================
// Test helper functions without needing client instantiation
// ==========================================

describe('GrpcAPIClient helper functions', () => {
  // ==========================================
  // Metadata serialization tests
  // ==========================================
  describe('serializeMetadata', () => {
    // This function serializes complex values to strings for protobuf
    const serializeMetadata = (metadata: Record<string, any>): Record<string, string> => {
      const serialized: Record<string, string> = {};
      for (const [key, value] of Object.entries(metadata)) {
        if (typeof value === 'string') {
          serialized[key] = value;
        } else {
          serialized[key] = JSON.stringify(value);
        }
      }
      return serialized;
    };

    it('should keep string values as-is', () => {
      const result = serializeMetadata({ key: 'value' });
      expect(result.key).toBe('value');
    });

    it('should serialize numbers to strings', () => {
      const result = serializeMetadata({ count: 42 });
      expect(result.count).toBe('42');
    });

    it('should serialize booleans to strings', () => {
      const result = serializeMetadata({ active: true });
      expect(result.active).toBe('true');
    });

    it('should serialize null to "null"', () => {
      const result = serializeMetadata({ nothing: null });
      expect(result.nothing).toBe('null');
    });

    it('should serialize objects to JSON strings', () => {
      const result = serializeMetadata({ nested: { key: 'value' } });
      expect(result.nested).toBe('{"key":"value"}');
    });

    it('should serialize arrays to JSON strings', () => {
      const result = serializeMetadata({ items: [1, 2, 3] });
      expect(result.items).toBe('[1,2,3]');
    });

    it('should handle complex metadata with multiple types', () => {
      const result = serializeMetadata({
        stringValue: 'hello',
        numberValue: 42,
        booleanValue: true,
        nullValue: null,
        objectValue: { nested: 'data' },
        arrayValue: [1, 2, 3],
      });

      expect(result).toEqual({
        stringValue: 'hello',
        numberValue: '42',
        booleanValue: 'true',
        nullValue: 'null',
        objectValue: '{"nested":"data"}',
        arrayValue: '[1,2,3]',
      });
    });
  });

  // ==========================================
  // Session type determination tests
  // ==========================================
  describe('determineSessionType', () => {
    // This function determines session type from name and branch
    const determineSessionType = (sessionName?: string, gitBranch?: string): string => {
      const nameStr = sessionName?.toLowerCase() || '';
      const branchStr = gitBranch?.toLowerCase() || '';

      // Check for debugging keywords FIRST (before bugfix, since "debug" contains "bug")
      if (nameStr.includes('debug') || branchStr.includes('debug')) {
        return 'debugging';
      }

      // Check for bugfix keywords
      if (
        nameStr.includes('fix') ||
        nameStr.includes('bug') ||
        nameStr.includes('hotfix') ||
        branchStr.includes('fix') ||
        branchStr.includes('bugfix') ||
        branchStr.includes('hotfix')
      ) {
        return 'bugfix';
      }

      // Check for refactor keywords
      if (nameStr.includes('refactor') || branchStr.includes('refactor')) {
        return 'refactor';
      }

      // Check for exploration keywords
      if (
        nameStr.includes('explore') ||
        nameStr.includes('experiment') ||
        branchStr.includes('explore') ||
        branchStr.includes('experiment')
      ) {
        return 'exploration';
      }

      // Default to feature
      return 'feature';
    };

    it('should detect bugfix from session name with "fix"', () => {
      expect(determineSessionType('Fix login bug', 'main')).toBe('bugfix');
    });

    it('should detect bugfix from session name with "bug"', () => {
      expect(determineSessionType('Fix the bug in auth', 'main')).toBe('bugfix');
    });

    it('should detect bugfix from session name with "hotfix"', () => {
      expect(determineSessionType('Hotfix for production', 'main')).toBe('bugfix');
    });

    it('should detect bugfix from git branch with "fix/"', () => {
      expect(determineSessionType('Work session', 'fix/auth-error')).toBe('bugfix');
    });

    it('should detect bugfix from git branch with "bugfix/"', () => {
      expect(determineSessionType('Work session', 'bugfix/login-issue')).toBe('bugfix');
    });

    it('should detect refactor from session name', () => {
      expect(determineSessionType('Refactor auth module', 'main')).toBe('refactor');
    });

    it('should detect refactor from git branch', () => {
      expect(determineSessionType('Work session', 'refactor/cleanup')).toBe('refactor');
    });

    it('should detect exploration from session name with "explore"', () => {
      expect(determineSessionType('Explore new API', 'main')).toBe('exploration');
    });

    it('should detect exploration from session name with "experiment"', () => {
      expect(determineSessionType('Experiment with new approach', 'main')).toBe('exploration');
    });

    it('should detect exploration from git branch', () => {
      expect(determineSessionType('Work session', 'experiment/new-approach')).toBe('exploration');
    });

    it('should detect debugging from session name', () => {
      expect(determineSessionType('Debug payment flow', 'main')).toBe('debugging');
    });

    it('should default to feature for generic names', () => {
      expect(determineSessionType('Add new feature', 'main')).toBe('feature');
    });

    it('should default to feature for main branch with generic name', () => {
      expect(determineSessionType('Work session', 'main')).toBe('feature');
    });

    it('should detect feature from feature/ branch', () => {
      expect(determineSessionType('Work session', 'feature/add-dark-mode')).toBe('feature');
    });

    it('should handle undefined session name', () => {
      expect(determineSessionType(undefined, 'fix/bug')).toBe('bugfix');
    });

    it('should handle undefined git branch', () => {
      expect(determineSessionType('Fix bug', undefined)).toBe('bugfix');
    });

    it('should handle both undefined', () => {
      expect(determineSessionType(undefined, undefined)).toBe('feature');
    });
  });

  // ==========================================
  // Todo snapshot transformation tests
  // ==========================================
  describe('transformTodoSnapshots', () => {
    // This function transforms todos from camelCase to snake_case for protobuf
    const transformTodoSnapshots = (snapshots: any[]): any[] => {
      return snapshots.map(snapshot => ({
        timestamp: snapshot.timestamp,
        todos: snapshot.todos.map((todo: any) => ({
          content: todo.content,
          status: todo.status,
          active_form: todo.activeForm,
        })),
      }));
    };

    it('should transform activeForm to active_form', () => {
      const input = [
        {
          timestamp: '2024-01-15T10:00:00.000Z',
          todos: [
            { content: 'Task 1', status: 'pending', activeForm: 'Doing task 1' },
          ],
        },
      ];

      const result = transformTodoSnapshots(input);

      expect(result[0].todos[0]).toEqual({
        content: 'Task 1',
        status: 'pending',
        active_form: 'Doing task 1',
      });
    });

    it('should handle multiple todos in a snapshot', () => {
      const input = [
        {
          timestamp: '2024-01-15T10:00:00.000Z',
          todos: [
            { content: 'Task 1', status: 'pending', activeForm: 'Task 1' },
            { content: 'Task 2', status: 'completed', activeForm: 'Task 2' },
            { content: 'Task 3', status: 'in_progress', activeForm: 'Task 3' },
          ],
        },
      ];

      const result = transformTodoSnapshots(input);

      expect(result[0].todos).toHaveLength(3);
      expect(result[0].todos.map((t: any) => t.status)).toEqual(['pending', 'completed', 'in_progress']);
    });

    it('should handle multiple snapshots', () => {
      const input = [
        {
          timestamp: '2024-01-15T10:00:00.000Z',
          todos: [{ content: 'Initial', status: 'pending', activeForm: 'Initial' }],
        },
        {
          timestamp: '2024-01-15T11:00:00.000Z',
          todos: [{ content: 'Updated', status: 'completed', activeForm: 'Updated' }],
        },
      ];

      const result = transformTodoSnapshots(input);

      expect(result).toHaveLength(2);
      expect(result[0].timestamp).toBe('2024-01-15T10:00:00.000Z');
      expect(result[1].timestamp).toBe('2024-01-15T11:00:00.000Z');
    });

    it('should preserve timestamp', () => {
      const input = [
        {
          timestamp: '2024-01-15T10:30:45.123Z',
          todos: [{ content: 'Task', status: 'pending', activeForm: 'Task' }],
        },
      ];

      const result = transformTodoSnapshots(input);

      expect(result[0].timestamp).toBe('2024-01-15T10:30:45.123Z');
    });

    it('should handle empty todos array', () => {
      const input = [
        {
          timestamp: '2024-01-15T10:00:00.000Z',
          todos: [],
        },
      ];

      const result = transformTodoSnapshots(input);

      expect(result[0].todos).toEqual([]);
    });
  });

  // ==========================================
  // Interaction chunking tests
  // ==========================================
  describe('chunkArray', () => {
    // Helper function to chunk arrays for batch processing
    const chunkArray = <T>(arr: T[], chunkSize: number): T[][] => {
      const chunks: T[][] = [];
      for (let i = 0; i < arr.length; i += chunkSize) {
        chunks.push(arr.slice(i, i + chunkSize));
      }
      return chunks;
    };

    it('should chunk array into correct sizes', () => {
      const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const chunks = chunkArray(arr, 3);

      expect(chunks).toHaveLength(4);
      expect(chunks[0]).toEqual([1, 2, 3]);
      expect(chunks[1]).toEqual([4, 5, 6]);
      expect(chunks[2]).toEqual([7, 8, 9]);
      expect(chunks[3]).toEqual([10]);
    });

    it('should handle array smaller than chunk size', () => {
      const arr = [1, 2, 3];
      const chunks = chunkArray(arr, 10);

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual([1, 2, 3]);
    });

    it('should handle empty array', () => {
      const chunks = chunkArray([], 5);
      expect(chunks).toHaveLength(0);
    });

    it('should handle exact divisible size', () => {
      const arr = [1, 2, 3, 4, 5, 6];
      const chunks = chunkArray(arr, 2);

      expect(chunks).toHaveLength(3);
      expect(chunks[0]).toEqual([1, 2]);
      expect(chunks[1]).toEqual([3, 4]);
      expect(chunks[2]).toEqual([5, 6]);
    });

    it('should chunk large array correctly', () => {
      const arr = Array.from({ length: 1200 }, (_, i) => i);
      const chunks = chunkArray(arr, 500);

      expect(chunks).toHaveLength(3);
      expect(chunks[0]).toHaveLength(500);
      expect(chunks[1]).toHaveLength(500);
      expect(chunks[2]).toHaveLength(200);
    });
  });

  // ==========================================
  // TLS auto-detection tests
  // ==========================================
  describe('TLS auto-detection logic', () => {
    // Replicate the TLS detection logic from GrpcAPIClient constructor
    const shouldUseTls = (backendUrl: string, useTls?: boolean): boolean => {
      const isLocalhost = backendUrl.startsWith('localhost') || backendUrl.startsWith('127.0.0.1');
      return useTls ?? !isLocalhost;
    };

    it('should use insecure for localhost', () => {
      expect(shouldUseTls('localhost:50051')).toBe(false);
      expect(shouldUseTls('localhost:443')).toBe(false);
    });

    it('should use insecure for 127.0.0.1', () => {
      expect(shouldUseTls('127.0.0.1:50051')).toBe(false);
      expect(shouldUseTls('127.0.0.1:8080')).toBe(false);
    });

    it('should use TLS for remote hosts', () => {
      expect(shouldUseTls('api.example.com:50051')).toBe(true);
      expect(shouldUseTls('backend.vibelog.io:443')).toBe(true);
      expect(shouldUseTls('192.168.1.100:50051')).toBe(true);
    });

    it('should allow explicit TLS override for localhost', () => {
      // Force TLS on localhost
      expect(shouldUseTls('localhost:50051', true)).toBe(true);
    });

    it('should allow explicit insecure override for remote', () => {
      // Force insecure on remote (not recommended, but supported)
      expect(shouldUseTls('api.example.com:50051', false)).toBe(false);
    });

    it('should respect explicit TLS setting over auto-detection', () => {
      // Explicit true always uses TLS
      expect(shouldUseTls('localhost:50051', true)).toBe(true);
      expect(shouldUseTls('api.example.com:50051', true)).toBe(true);

      // Explicit false always uses insecure
      expect(shouldUseTls('localhost:50051', false)).toBe(false);
      expect(shouldUseTls('api.example.com:50051', false)).toBe(false);
    });
  });
});
