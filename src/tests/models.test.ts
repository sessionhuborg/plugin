/**
 * Tests for Zod schema validation in models.ts
 * Covers: ProjectDataSchema validation
 */

import { describe, it, expect } from 'vitest';
import { ProjectDataSchema, type ProjectData } from '../models.js';

describe('ProjectDataSchema', () => {
  // ==========================================
  // Test 1: Valid project data with required fields
  // ==========================================
  it('should validate project data with only required fields', () => {
    const validData = {
      path: '/Users/dev/my-project',
      name: 'my-project',
    };

    const result = ProjectDataSchema.safeParse(validData);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.path).toBe('/Users/dev/my-project');
      expect(result.data.name).toBe('my-project');
      expect(result.data.gitRemote).toBeUndefined();
      expect(result.data.branch).toBeUndefined();
    }
  });

  // ==========================================
  // Test 2: Valid project data with all fields
  // ==========================================
  it('should validate project data with all optional fields', () => {
    const validData: ProjectData = {
      path: '/Users/dev/my-project',
      name: 'my-project',
      gitRemote: 'https://github.com/user/my-project.git',
      branch: 'feature/new-feature',
    };

    const result = ProjectDataSchema.safeParse(validData);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.path).toBe('/Users/dev/my-project');
      expect(result.data.name).toBe('my-project');
      expect(result.data.gitRemote).toBe('https://github.com/user/my-project.git');
      expect(result.data.branch).toBe('feature/new-feature');
    }
  });

  // ==========================================
  // Test 3: Invalid - missing required path field
  // ==========================================
  it('should fail validation when path is missing', () => {
    const invalidData = {
      name: 'my-project',
    };

    const result = ProjectDataSchema.safeParse(invalidData);

    expect(result.success).toBe(false);
    if (!result.success) {
      const pathError = result.error.issues.find((issue) =>
        issue.path.includes('path')
      );
      expect(pathError).toBeDefined();
      expect(pathError?.code).toBe('invalid_type');
    }
  });

  // ==========================================
  // Test 4: Invalid - missing required name field
  // ==========================================
  it('should fail validation when name is missing', () => {
    const invalidData = {
      path: '/Users/dev/my-project',
    };

    const result = ProjectDataSchema.safeParse(invalidData);

    expect(result.success).toBe(false);
    if (!result.success) {
      const nameError = result.error.issues.find((issue) =>
        issue.path.includes('name')
      );
      expect(nameError).toBeDefined();
      expect(nameError?.code).toBe('invalid_type');
    }
  });

  // ==========================================
  // Test 5: Invalid - wrong type for fields
  // ==========================================
  it('should fail validation when fields have wrong types', () => {
    const invalidData = {
      path: 123, // Should be string
      name: ['array'], // Should be string
      gitRemote: true, // Should be string or undefined
    };

    const result = ProjectDataSchema.safeParse(invalidData);

    expect(result.success).toBe(false);
    if (!result.success) {
      // Should have multiple type errors
      expect(result.error.issues.length).toBeGreaterThanOrEqual(2);

      const pathError = result.error.issues.find((issue) =>
        issue.path.includes('path')
      );
      expect(pathError?.code).toBe('invalid_type');

      const nameError = result.error.issues.find((issue) =>
        issue.path.includes('name')
      );
      expect(nameError?.code).toBe('invalid_type');
    }
  });

  // ==========================================
  // Additional edge cases
  // ==========================================
  describe('edge cases', () => {
    it('should accept empty strings for required fields (validation passes, semantically wrong)', () => {
      const data = {
        path: '',
        name: '',
      };

      const result = ProjectDataSchema.safeParse(data);

      // Zod string schema allows empty strings by default
      expect(result.success).toBe(true);
    });

    it('should strip unknown properties in strict mode', () => {
      const dataWithExtra = {
        path: '/project',
        name: 'my-project',
        unknownField: 'should be ignored',
        anotherUnknown: 123,
      };

      // Using .parse which doesn't strip by default
      const result = ProjectDataSchema.safeParse(dataWithExtra);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.path).toBe('/project');
        expect(result.data.name).toBe('my-project');
        // Unknown fields are preserved in default mode
        expect((result.data as any).unknownField).toBeUndefined();
      }
    });

    it('should handle null values as invalid', () => {
      const nullData = {
        path: null,
        name: null,
      };

      const result = ProjectDataSchema.safeParse(nullData);

      expect(result.success).toBe(false);
    });

    it('should handle undefined optional fields correctly', () => {
      const data = {
        path: '/project',
        name: 'test',
        gitRemote: undefined,
        branch: undefined,
      };

      const result = ProjectDataSchema.safeParse(data);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.gitRemote).toBeUndefined();
        expect(result.data.branch).toBeUndefined();
      }
    });
  });
});

// ==========================================
// Type inference tests
// ==========================================
describe('Type inference', () => {
  it('should correctly infer ProjectData type from schema', () => {
    const validProject: ProjectData = {
      path: '/test/path',
      name: 'test-project',
      gitRemote: 'https://github.com/test/test.git',
      branch: 'main',
    };

    // This test mainly validates that TypeScript types are correctly inferred
    // If the types were wrong, this wouldn't compile
    expect(validProject.path).toBe('/test/path');
    expect(validProject.name).toBe('test-project');
    expect(validProject.gitRemote).toBe('https://github.com/test/test.git');
    expect(validProject.branch).toBe('main');
  });
});
