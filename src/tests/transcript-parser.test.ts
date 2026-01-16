/**
 * Tests for TranscriptParser
 * Covers: quickExtractTimestamp, quickExtractSessionId, extractLanguagesFromSession,
 *         filterLastExchanges, parseTranscriptFile, parseSubAgentFile
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TranscriptParser } from '../transcript-parser.js';

// Mock fs/promises
vi.mock('fs/promises', () => ({
  default: {
    open: vi.fn(),
    readFile: vi.fn(),
    readdir: vi.fn(),
    stat: vi.fn(),
  },
  open: vi.fn(),
  readFile: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
}));

// Mock logger to suppress output during tests
vi.mock('../logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock storage-uploader
vi.mock('../storage-uploader.js', () => ({
  StorageUploader: vi.fn().mockImplementation(() => ({
    extractImagesFromContent: vi.fn().mockReturnValue([]),
    uploadImage: vi.fn().mockResolvedValue(null),
    replaceImageWithReference: vi.fn().mockImplementation((content) => content),
  })),
}));

describe('TranscriptParser', () => {
  let parser: TranscriptParser;

  // Global helper to mock fs.stat for file size check
  const mockFileStat = async (size: number = 1000) => {
    const fs = await import('fs/promises');
    vi.mocked(fs.stat).mockResolvedValue({ size } as any);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    parser = new TranscriptParser();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================
  // quickExtractTimestamp tests (4 tests)
  // ==========================================
  describe('quickExtractTimestamp', () => {
    it('should extract timestamp from valid JSONL file', async () => {
      const fs = await import('fs/promises');
      const mockFd = {
        read: vi.fn().mockResolvedValue({
          bytesRead: 100,
        }),
        close: vi.fn().mockResolvedValue(undefined),
      };

      const testTimestamp = '2024-01-15T10:30:00.000Z';
      const jsonlContent = JSON.stringify({
        sessionId: 'test-session-123',
        timestamp: testTimestamp,
        type: 'user',
      });

      // Mock buffer behavior
      vi.mocked(fs.open).mockResolvedValue(mockFd as any);
      mockFd.read.mockImplementation((buffer: Buffer) => {
        buffer.write(jsonlContent + '\n');
        return Promise.resolve({ bytesRead: jsonlContent.length + 1 });
      });

      const result = await parser.quickExtractTimestamp('/path/to/test.jsonl');

      expect(result).toBeInstanceOf(Date);
      expect(result?.toISOString()).toBe(testTimestamp);
      expect(mockFd.close).toHaveBeenCalled();
    });

    it('should return null for empty file', async () => {
      const fs = await import('fs/promises');
      const mockFd = {
        read: vi.fn().mockResolvedValue({ bytesRead: 0 }),
        close: vi.fn().mockResolvedValue(undefined),
      };

      vi.mocked(fs.open).mockResolvedValue(mockFd as any);

      const result = await parser.quickExtractTimestamp('/path/to/empty.jsonl');

      expect(result).toBeNull();
    });

    it('should return null when file has no timestamp field', async () => {
      const fs = await import('fs/promises');
      const mockFd = {
        read: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
      };

      const jsonlContent = JSON.stringify({
        sessionId: 'test-session',
        type: 'user',
        // No timestamp field
      });

      vi.mocked(fs.open).mockResolvedValue(mockFd as any);
      mockFd.read.mockImplementation((buffer: Buffer) => {
        buffer.write(jsonlContent + '\n');
        return Promise.resolve({ bytesRead: jsonlContent.length + 1 });
      });

      const result = await parser.quickExtractTimestamp('/path/to/no-timestamp.jsonl');

      expect(result).toBeNull();
    });

    it('should return null on file read error', async () => {
      const fs = await import('fs/promises');
      vi.mocked(fs.open).mockRejectedValue(new Error('File not found'));

      const result = await parser.quickExtractTimestamp('/path/to/nonexistent.jsonl');

      expect(result).toBeNull();
    });
  });

  // ==========================================
  // quickExtractSessionId tests (2 tests)
  // ==========================================
  describe('quickExtractSessionId', () => {
    it('should extract sessionId from valid JSONL file', async () => {
      const fs = await import('fs/promises');
      const mockFd = {
        read: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
      };

      // Must be a valid 36-character UUID format to match regex
      const testSessionId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      const jsonlContent = JSON.stringify({
        sessionId: testSessionId,
        timestamp: '2024-01-15T10:30:00.000Z',
      });

      vi.mocked(fs.open).mockResolvedValue(mockFd as any);
      mockFd.read.mockImplementation((buffer: Buffer) => {
        buffer.write(jsonlContent + '\n');
        return Promise.resolve({ bytesRead: jsonlContent.length + 1 });
      });

      const result = await parser.quickExtractSessionId('/path/to/test.jsonl');

      expect(result).toBe(testSessionId);
    });

    it('should return null when sessionId is not present', async () => {
      const fs = await import('fs/promises');
      const mockFd = {
        read: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
      };

      const jsonlContent = JSON.stringify({
        timestamp: '2024-01-15T10:30:00.000Z',
        type: 'assistant',
      });

      vi.mocked(fs.open).mockResolvedValue(mockFd as any);
      mockFd.read.mockImplementation((buffer: Buffer) => {
        buffer.write(jsonlContent + '\n');
        return Promise.resolve({ bytesRead: jsonlContent.length + 1 });
      });

      const result = await parser.quickExtractSessionId('/path/to/no-session.jsonl');

      expect(result).toBeNull();
    });
  });

  // ==========================================
  // extractLanguagesFromSession tests (4 tests)
  // ==========================================
  describe('extractLanguagesFromSession', () => {
    // Access private method using type casting
    const extractLanguages = (parser: TranscriptParser, lines: string[]) => {
      return (parser as any).extractLanguagesFromSession(lines);
    };

    it('should extract single language from toolUseResult.filePath', () => {
      const lines = [
        JSON.stringify({
          toolUseResult: { filePath: '/src/component.tsx' },
        }),
      ];

      const result = extractLanguages(parser, lines);

      expect(result).toContain('typescript');
      expect(result).toHaveLength(1);
    });

    it('should extract multiple languages from various file types', () => {
      const lines = [
        JSON.stringify({
          toolUseResult: { filePath: '/src/app.tsx' },
        }),
        JSON.stringify({
          tool_input: { file_path: '/backend/main.go' },
        }),
        JSON.stringify({
          message: {
            content: [
              {
                type: 'tool_use',
                input: { file_path: '/scripts/deploy.py' },
              },
            ],
          },
        }),
      ];

      const result = extractLanguages(parser, lines);

      expect(result).toContain('typescript');
      expect(result).toContain('go');
      expect(result).toContain('python');
      expect(result).toHaveLength(3);
    });

    it('should return empty array for entries with no file paths', () => {
      const lines = [
        JSON.stringify({
          type: 'user',
          message: { content: 'Hello, assistant!' },
        }),
        JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Hi there!' }] },
        }),
      ];

      const result = extractLanguages(parser, lines);

      expect(result).toEqual([]);
    });

    it('should deduplicate languages', () => {
      const lines = [
        JSON.stringify({
          toolUseResult: { filePath: '/src/utils.ts' },
        }),
        JSON.stringify({
          toolUseResult: { filePath: '/src/components/Button.tsx' },
        }),
        JSON.stringify({
          toolUseResult: { filePath: '/src/hooks/useAuth.ts' },
        }),
      ];

      const result = extractLanguages(parser, lines);

      expect(result).toContain('typescript');
      expect(result).toHaveLength(1);
    });
  });

  // ==========================================
  // filterLastExchanges tests (3 tests)
  // ==========================================
  describe('filterLastExchanges', () => {
    const filterExchanges = (
      parser: TranscriptParser,
      interactions: any[],
      count: number
    ) => {
      return (parser as any).filterLastExchanges(interactions, count);
    };

    it('should filter to last N exchanges', () => {
      const interactions = [
        { interaction_type: 'prompt', content: 'First prompt' },
        { interaction_type: 'response', content: 'First response' },
        { interaction_type: 'prompt', content: 'Second prompt' },
        { interaction_type: 'response', content: 'Second response' },
        { interaction_type: 'prompt', content: 'Third prompt' },
        { interaction_type: 'response', content: 'Third response' },
      ];

      const result = filterExchanges(parser, interactions, 2);

      expect(result.interactions).toHaveLength(4);
      expect(result.interactions[0].content).toBe('Second prompt');
      expect(result.startIndex).toBe(2);
    });

    it('should return all interactions when count exceeds exchange count', () => {
      const interactions = [
        { interaction_type: 'prompt', content: 'Only prompt' },
        { interaction_type: 'response', content: 'Only response' },
      ];

      const result = filterExchanges(parser, interactions, 10);

      expect(result.interactions).toHaveLength(2);
      expect(result.startIndex).toBe(0);
    });

    it('should handle empty interactions array', () => {
      const result = filterExchanges(parser, [], 5);

      expect(result.interactions).toEqual([]);
      expect(result.startIndex).toBe(0);
    });
  });

  // ==========================================
  // parseTranscriptFile tests (5 tests)
  // ==========================================
  describe('parseTranscriptFile', () => {
    // Helper to setup stat mock for file size check
    const mockStat = (fs: any, size: number = 1000) => {
      vi.mocked(fs.stat).mockResolvedValue({ size } as any);
    };

    it('should parse valid transcript file with session metadata', async () => {
      const fs = await import('fs/promises');
      mockStat(fs);

      const jsonlLines = [
        JSON.stringify({
          sessionId: 'session-123',
          timestamp: '2024-01-15T10:00:00.000Z',
          cwd: '/project/path',
          gitBranch: 'main',
          type: 'user',
          message: { role: 'user', content: 'Hello, Claude!' },
        }),
        JSON.stringify({
          type: 'assistant',
          timestamp: '2024-01-15T10:00:05.000Z',
          message: {
            role: 'assistant',
            model: 'claude-3-sonnet',
            content: [{ type: 'text', text: 'Hello! How can I help?' }],
            usage: { input_tokens: 100, output_tokens: 50 },
          },
        }),
      ];

      vi.mocked(fs.readFile).mockResolvedValue(jsonlLines.join('\n'));

      const result = await parser.parseTranscriptFile('/path/to/session.jsonl');

      expect(result).not.toBeNull();
      expect(result?.sessionId).toBe('session-123');
      expect(result?.projectPath).toBe('/project/path');
      expect(result?.gitBranch).toBe('main');
      expect(result?.interactions).toHaveLength(2);
      expect(result?.totalInputTokens).toBe(100);
      expect(result?.totalOutputTokens).toBe(50);
    });

    it('should track token usage across multiple messages', async () => {
      const fs = await import('fs/promises');
      mockStat(fs);

      const jsonlLines = [
        JSON.stringify({
          sessionId: 'session-tokens',
          timestamp: '2024-01-15T10:00:00.000Z',
          type: 'user',
          message: { role: 'user', content: 'First message' },
        }),
        JSON.stringify({
          type: 'assistant',
          timestamp: '2024-01-15T10:00:05.000Z',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Response 1' }],
            usage: {
              input_tokens: 100,
              output_tokens: 50,
              cache_creation_input_tokens: 20,
              cache_read_input_tokens: 10,
            },
          },
        }),
        JSON.stringify({
          type: 'user',
          timestamp: '2024-01-15T10:01:00.000Z',
          message: { role: 'user', content: 'Second message' },
        }),
        JSON.stringify({
          type: 'assistant',
          timestamp: '2024-01-15T10:01:05.000Z',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Response 2' }],
            usage: {
              input_tokens: 150,
              output_tokens: 75,
              cache_creation_input_tokens: 30,
              cache_read_input_tokens: 15,
            },
          },
        }),
      ];

      vi.mocked(fs.readFile).mockResolvedValue(jsonlLines.join('\n'));

      const result = await parser.parseTranscriptFile('/path/to/session.jsonl');

      expect(result?.totalInputTokens).toBe(250);
      expect(result?.totalOutputTokens).toBe(125);
      expect(result?.totalCacheCreateTokens).toBe(50);
      expect(result?.totalCacheReadTokens).toBe(25);
    });

    it('should extract tool calls from assistant messages', async () => {
      const fs = await import('fs/promises');
      mockStat(fs);

      const jsonlLines = [
        JSON.stringify({
          sessionId: 'session-tools',
          timestamp: '2024-01-15T10:00:00.000Z',
          type: 'user',
          message: { role: 'user', content: 'Read the file' },
        }),
        JSON.stringify({
          type: 'assistant',
          timestamp: '2024-01-15T10:00:05.000Z',
          message: {
            role: 'assistant',
            content: [
              { type: 'text', text: 'Let me read that file for you.' },
              {
                type: 'tool_use',
                id: 'tool-123',
                name: 'Read',
                input: { file_path: '/src/index.ts' },
              },
            ],
            usage: { input_tokens: 100, output_tokens: 50 },
          },
        }),
      ];

      vi.mocked(fs.readFile).mockResolvedValue(jsonlLines.join('\n'));

      const result = await parser.parseTranscriptFile('/path/to/session.jsonl');

      expect(result).not.toBeNull();
      const toolCalls = result?.interactions.filter(
        (i) => i.interaction_type === 'tool_call'
      );
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls?.[0].metadata.tool_name).toBe('Read');
      expect(toolCalls?.[0].metadata.tool_input.file_path).toBe('/src/index.ts');
    });

    it('should extract todo snapshots from TodoWrite tool calls', async () => {
      const fs = await import('fs/promises');
      mockStat(fs);

      const jsonlLines = [
        JSON.stringify({
          sessionId: 'session-todos',
          timestamp: '2024-01-15T10:00:00.000Z',
          type: 'user',
          message: { role: 'user', content: 'Create a todo list' },
        }),
        JSON.stringify({
          type: 'assistant',
          timestamp: '2024-01-15T10:00:05.000Z',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'todo-123',
                name: 'TodoWrite',
                input: {
                  todos: [
                    { content: 'Task 1', status: 'pending', activeForm: 'Creating Task 1' },
                    { content: 'Task 2', status: 'in_progress', activeForm: 'Working on Task 2' },
                  ],
                },
              },
            ],
            usage: { input_tokens: 100, output_tokens: 50 },
          },
        }),
      ];

      vi.mocked(fs.readFile).mockResolvedValue(jsonlLines.join('\n'));

      const result = await parser.parseTranscriptFile('/path/to/session.jsonl');

      expect(result?.todoSnapshots).toHaveLength(1);
      expect(result?.todoSnapshots?.[0].todos).toHaveLength(2);
      expect(result?.todoSnapshots?.[0].todos[0].content).toBe('Task 1');
    });

    it('should extract plans from ExitPlanMode tool calls', async () => {
      const fs = await import('fs/promises');
      mockStat(fs);

      const jsonlLines = [
        JSON.stringify({
          sessionId: 'session-plans',
          timestamp: '2024-01-15T10:00:00.000Z',
          type: 'user',
          message: { role: 'user', content: 'Plan the feature' },
        }),
        JSON.stringify({
          type: 'assistant',
          timestamp: '2024-01-15T10:00:05.000Z',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'plan-123',
                name: 'ExitPlanMode',
                input: {
                  plan: '1. Create component\n2. Add tests\n3. Update docs',
                },
              },
            ],
            usage: { input_tokens: 100, output_tokens: 50 },
          },
        }),
      ];

      vi.mocked(fs.readFile).mockResolvedValue(jsonlLines.join('\n'));

      const result = await parser.parseTranscriptFile('/path/to/session.jsonl');

      expect(result?.plans).toHaveLength(1);
      expect(result?.plans?.[0].plan).toContain('Create component');
      expect(result?.planningModeInfo?.hasPlanningMode).toBe(true);
      expect(result?.planningModeInfo?.planningCycles).toBe(1);
    });
  });

  // ==========================================
  // parseSubAgentFile tests (2 tests)
  // ==========================================
  describe('parseSubAgentFile', () => {
    it('should parse sub-agent transcript file', async () => {
      const fs = await import('fs/promises');

      const jsonlLines = [
        JSON.stringify({
          type: 'user',
          timestamp: '2024-01-15T10:00:00.000Z',
          message: { role: 'user', content: 'Implement the feature' },
        }),
        JSON.stringify({
          type: 'assistant',
          timestamp: '2024-01-15T10:00:05.000Z',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Starting implementation...' }],
            usage: { input_tokens: 100, output_tokens: 50 },
          },
        }),
        JSON.stringify({
          type: 'assistant',
          timestamp: '2024-01-15T10:00:10.000Z',
          message: {
            role: 'assistant',
            content: [
              { type: 'text', text: 'Writing code...' },
              {
                type: 'tool_use',
                id: 'tool-456',
                name: 'Write',
                input: { file_path: '/src/feature.ts', content: 'code here' },
              },
            ],
            usage: { input_tokens: 150, output_tokens: 100 },
          },
        }),
      ];

      vi.mocked(fs.readFile).mockResolvedValue(jsonlLines.join('\n'));

      const result = await parser.parseSubAgentFile(
        '/path/to/agent-123.jsonl',
        'agent-123',
        'Implement the authentication feature',
        'Create a login form with validation',
        5
      );

      expect(result).not.toBeNull();
      expect(result?.agentId).toBe('agent-123');
      expect(result?.taskDescription).toBe('Implement the authentication feature');
      expect(result?.taskPrompt).toBe('Create a login form with validation');
      expect(result?.interactionIndex).toBe(5);
      expect(result?.interactions.length).toBeGreaterThan(0);
      expect(result?.messages.length).toBeGreaterThan(0);
      expect(result?.inputTokens).toBe(250);
      expect(result?.outputTokens).toBe(150);
      expect(result?.totalTokens).toBe(400);
    });

    it('should return null for empty sub-agent file', async () => {
      const fs = await import('fs/promises');

      vi.mocked(fs.readFile).mockResolvedValue('');

      const result = await parser.parseSubAgentFile(
        '/path/to/empty-agent.jsonl',
        'agent-empty',
        null,
        null,
        0
      );

      expect(result).toBeNull();
    });
  });

  // ==========================================
  // Additional edge case tests
  // ==========================================
  describe('edge cases', () => {
    it('should return null for empty transcript file', async () => {
      const fs = await import('fs/promises');
      await mockFileStat();
      vi.mocked(fs.readFile).mockResolvedValue('');

      const result = await parser.parseTranscriptFile('/path/to/empty.jsonl');

      expect(result).toBeNull();
    });

    it('should handle malformed JSON lines gracefully', async () => {
      const fs = await import('fs/promises');
      await mockFileStat();

      const jsonlLines = [
        'not valid json',
        JSON.stringify({
          sessionId: 'session-valid',
          timestamp: '2024-01-15T10:00:00.000Z',
          type: 'user',
          message: { role: 'user', content: 'Valid message' },
        }),
        '{ broken json',
      ];

      vi.mocked(fs.readFile).mockResolvedValue(jsonlLines.join('\n'));

      const result = await parser.parseTranscriptFile('/path/to/mixed.jsonl');

      expect(result).not.toBeNull();
      expect(result?.sessionId).toBe('session-valid');
    });

    it('should set user info via setCurrentUser', () => {
      const userInfo = {
        userId: 'user-123',
        email: 'test@example.com',
        subscriptionTier: 'pro',
      };

      parser.setCurrentUser(userInfo);

      // Access private field to verify
      expect((parser as any).currentUser).toEqual(userInfo);
    });
  });

  // ==========================================
  // Tests for bug fixes
  // ==========================================
  describe('bug fixes', () => {
    describe('replaceImagesWithReferences - multiple images fix', () => {
      it('should assign sequential indices to multiple images', () => {
        // Access private method for testing
        const replaceImagesWithReferences = (parser as any).replaceImagesWithReferences.bind(parser);

        const messageContent = [
          { type: 'text', text: 'Here are the images:' },
          { type: 'image', source: { type: 'base64', data: 'image1data' } },
          { type: 'text', text: 'And another:' },
          { type: 'image', source: { type: 'base64', data: 'image2data' } },
          { type: 'image', source: { type: 'base64', data: 'image3data' } },
        ];

        const startIndex = 5; // Starting attachment index
        const result = replaceImagesWithReferences(messageContent, startIndex);

        // Text items should remain unchanged
        expect(result[0]).toEqual({ type: 'text', text: 'Here are the images:' });
        expect(result[2]).toEqual({ type: 'text', text: 'And another:' });

        // Images should be replaced with sequential indices
        expect(result[1]).toEqual({ type: 'image_ref', attachment_index: 5 });
        expect(result[3]).toEqual({ type: 'image_ref', attachment_index: 6 });
        expect(result[4]).toEqual({ type: 'image_ref', attachment_index: 7 });
      });

      it('should handle content with no images', () => {
        const replaceImagesWithReferences = (parser as any).replaceImagesWithReferences.bind(parser);

        const messageContent = [
          { type: 'text', text: 'No images here' },
          { type: 'tool_use', name: 'Read', input: {} },
        ];

        const result = replaceImagesWithReferences(messageContent, 0);

        expect(result).toEqual(messageContent);
      });

      it('should only replace base64 images, not URLs', () => {
        const replaceImagesWithReferences = (parser as any).replaceImagesWithReferences.bind(parser);

        const messageContent = [
          { type: 'image', source: { type: 'base64', data: 'base64data' } },
          { type: 'image', source: { type: 'url', url: 'https://example.com/img.png' } },
        ];

        const result = replaceImagesWithReferences(messageContent, 0);

        expect(result[0]).toEqual({ type: 'image_ref', attachment_index: 0 });
        // URL image should remain unchanged
        expect(result[1]).toEqual({ type: 'image', source: { type: 'url', url: 'https://example.com/img.png' } });
      });
    });

    describe('response interactions include token metadata', () => {
      it('should include token metadata in response interactions', async () => {
        const fs = await import('fs/promises');
        await mockFileStat();

        const jsonlLines = [
          JSON.stringify({
            sessionId: 'session-tokens',
            timestamp: '2024-01-15T10:00:00.000Z',
            type: 'user',
            message: { role: 'user', content: 'Hello' },
          }),
          JSON.stringify({
            type: 'assistant',
            timestamp: '2024-01-15T10:00:05.000Z',
            message: {
              role: 'assistant',
              content: [{ type: 'text', text: 'Hi there!' }],
              usage: {
                input_tokens: 100,
                output_tokens: 50,
                cache_creation_input_tokens: 10,
                cache_read_input_tokens: 5,
              },
            },
          }),
        ];

        vi.mocked(fs.readFile).mockResolvedValue(jsonlLines.join('\n'));

        const result = await parser.parseTranscriptFile('/path/to/session.jsonl');

        const responseInteraction = result?.interactions.find(
          (i) => i.interaction_type === 'response'
        );

        expect(responseInteraction).toBeDefined();
        expect(responseInteraction?.metadata).toBeDefined();
        expect(responseInteraction?.metadata?.input_tokens).toBe(100);
        expect(responseInteraction?.metadata?.output_tokens).toBe(50);
        expect(responseInteraction?.metadata?.cache_creation_input_tokens).toBe(10);
        expect(responseInteraction?.metadata?.cache_read_input_tokens).toBe(5);
      });

      it('should correctly sum tokens when filtering with lastExchanges', async () => {
        const fs = await import('fs/promises');
        await mockFileStat();

        // Create multiple exchanges
        const jsonlLines = [
          // Exchange 1
          JSON.stringify({
            sessionId: 'session-filter',
            timestamp: '2024-01-15T10:00:00.000Z',
            type: 'user',
            message: { role: 'user', content: 'First question' },
          }),
          JSON.stringify({
            type: 'assistant',
            timestamp: '2024-01-15T10:00:05.000Z',
            message: {
              role: 'assistant',
              content: [{ type: 'text', text: 'First answer' }],
              usage: {
                input_tokens: 100,
                output_tokens: 50,
                cache_creation_input_tokens: 10,
                cache_read_input_tokens: 5,
              },
            },
          }),
          // Exchange 2
          JSON.stringify({
            timestamp: '2024-01-15T10:01:00.000Z',
            type: 'user',
            message: { role: 'user', content: 'Second question' },
          }),
          JSON.stringify({
            type: 'assistant',
            timestamp: '2024-01-15T10:01:05.000Z',
            message: {
              role: 'assistant',
              content: [{ type: 'text', text: 'Second answer' }],
              usage: {
                input_tokens: 200,
                output_tokens: 100,
                cache_creation_input_tokens: 20,
                cache_read_input_tokens: 10,
              },
            },
          }),
        ];

        vi.mocked(fs.readFile).mockResolvedValue(jsonlLines.join('\n'));

        // Filter to last 1 exchange
        const result = await parser.parseTranscriptFile('/path/to/session.jsonl', 1);

        // Should have tokens only from the second exchange
        expect(result?.totalInputTokens).toBe(200);
        expect(result?.totalOutputTokens).toBe(100);
        expect(result?.totalCacheCreateTokens).toBe(20);
        expect(result?.totalCacheReadTokens).toBe(10);
      });
    });
  });
});
