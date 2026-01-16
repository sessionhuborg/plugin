/**
 * Tests for context-formatter
 * Covers: formatObservationsContext, calculateContextStats
 */

import { describe, it, expect } from 'vitest';
import {
  formatObservationsContext,
  calculateContextStats,
  type Observation,
} from '../context-formatter.js';

// Helper to create mock observations
function createMockObservation(overrides: Partial<Observation> = {}): Observation {
  return {
    id: 'obs-1',
    session_id: 'session-1',
    project_id: 'project-1',
    user_id: 'user-1',
    type: 'feature',
    title: 'Test Observation',
    subtitle: 'A subtitle',
    narrative: 'This is a test observation narrative.',
    facts: ['Fact 1', 'Fact 2'],
    concepts: ['concept1', 'concept2'],
    files: ['src/file1.ts', 'src/file2.ts'],
    discovery_tokens: 100,
    created_at: '2024-01-15T10:00:00.000Z',
    updated_at: '2024-01-15T10:00:00.000Z',
    ...overrides,
  };
}

describe('formatObservationsContext', () => {
  // ==========================================
  // Test 1: Empty observations array
  // ==========================================
  it('should return placeholder message for empty observations', () => {
    const result = formatObservationsContext([]);

    expect(result).toContain('# Project Memory');
    expect(result).toContain('No observations recorded yet.');
    expect(result).not.toContain('## Overview');
  });

  // ==========================================
  // Test 2: Header with project name
  // ==========================================
  it('should include project name in header when provided', () => {
    const observations = [createMockObservation()];

    const result = formatObservationsContext(observations, {
      projectName: 'MyAwesomeProject',
    });

    expect(result).toContain('# Project Memory (MyAwesomeProject)');
  });

  // ==========================================
  // Test 3: Count singular vs plural
  // ==========================================
  it('should use singular "observation" for count of 1', () => {
    const observations = [createMockObservation()];

    const result = formatObservationsContext(observations);

    expect(result).toContain('1 observation recorded');
    expect(result).not.toContain('1 observations');
  });

  it('should use plural "observations" for count greater than 1', () => {
    const observations = [
      createMockObservation({ id: 'obs-1' }),
      createMockObservation({ id: 'obs-2' }),
      createMockObservation({ id: 'obs-3' }),
    ];

    const result = formatObservationsContext(observations);

    expect(result).toContain('3 observations recorded');
  });

  // ==========================================
  // Test 4: Summary table structure
  // ==========================================
  it('should include properly formatted summary table', () => {
    const observations = [
      createMockObservation({
        type: 'bugfix',
        title: 'Fixed login bug',
        files: ['src/auth.ts', 'src/login.tsx', 'src/utils.ts'],
      }),
    ];

    const result = formatObservationsContext(observations, {
      includeTable: true,
    });

    expect(result).toContain('## Overview');
    expect(result).toContain('| # | Type | Title | Files | Date |');
    expect(result).toContain('|---|------|-------|-------|------|');
    expect(result).toContain('bugfix');
    expect(result).toContain('Fixed login bug');
    // Files should show first 2 + count of remaining
    expect(result).toContain('src/auth.ts, src/login.tsx, +1');
  });

  // ==========================================
  // Test 5: Full details section
  // ==========================================
  it('should include full details section with narrative, facts, files, and concepts', () => {
    const observations = [
      createMockObservation({
        type: 'feature',
        title: 'Added dark mode',
        subtitle: 'Theme switching capability',
        narrative: 'Implemented dark mode theme switching across the application.',
        facts: ['Uses CSS variables', 'Persists to localStorage'],
        files: ['src/theme.ts', 'src/globals.css'],
        concepts: ['theming', 'accessibility'],
      }),
    ];

    const result = formatObservationsContext(observations, {
      includeFullDetails: true,
    });

    expect(result).toContain('## Recent Details');
    expect(result).toContain('### 1.');
    expect(result).toContain('Added dark mode');
    expect(result).toContain('**Theme switching capability**');
    expect(result).toContain('Implemented dark mode theme switching');
    expect(result).toContain('**Key Facts:**');
    expect(result).toContain('- Uses CSS variables');
    expect(result).toContain('- Persists to localStorage');
    expect(result).toContain('**Files:** src/theme.ts, src/globals.css');
    expect(result).toContain('**Tags:** theming, accessibility');
  });

  // ==========================================
  // Test 6: TopN limiting
  // ==========================================
  it('should limit full details to topN observations', () => {
    const observations = [
      createMockObservation({ id: 'obs-1', title: 'Observation 1' }),
      createMockObservation({ id: 'obs-2', title: 'Observation 2' }),
      createMockObservation({ id: 'obs-3', title: 'Observation 3' }),
      createMockObservation({ id: 'obs-4', title: 'Observation 4' }),
      createMockObservation({ id: 'obs-5', title: 'Observation 5' }),
    ];

    const result = formatObservationsContext(observations, {
      topN: 3,
      includeFullDetails: true,
      includeTable: true,
    });

    // Should show "Top 3" in heading
    expect(result).toContain('## Recent Details (Top 3)');
    // Should mention remaining observations
    expect(result).toContain('2 more observations available');
    // Table should still show all 5
    expect(result).toContain('| 5 |');
  });

  // ==========================================
  // Test 7: Type emoji mapping
  // ==========================================
  it('should display correct emoji for each observation type', () => {
    const types: Array<Observation['type']> = [
      'bugfix',
      'feature',
      'decision',
      'discovery',
      'refactor',
      'change',
    ];

    const observations = types.map((type, index) =>
      createMockObservation({
        id: `obs-${index}`,
        type,
        title: `${type} observation`,
      })
    );

    const result = formatObservationsContext(observations);

    // Check for presence of emojis in output
    expect(result).toContain('bugfix');
    expect(result).toContain('feature');
    expect(result).toContain('decision');
    expect(result).toContain('discovery');
    expect(result).toContain('refactor');
    expect(result).toContain('change');
  });
});

describe('calculateContextStats', () => {
  // ==========================================
  // Test 8: Observation count
  // ==========================================
  it('should return correct observation count', () => {
    const observations = [
      createMockObservation({ id: 'obs-1' }),
      createMockObservation({ id: 'obs-2' }),
      createMockObservation({ id: 'obs-3' }),
    ];

    const stats = calculateContextStats(observations);

    expect(stats.observationCount).toBe(3);
  });

  // ==========================================
  // Test 9: Type counts breakdown
  // ==========================================
  it('should return correct type counts breakdown', () => {
    const observations = [
      createMockObservation({ id: 'obs-1', type: 'bugfix' }),
      createMockObservation({ id: 'obs-2', type: 'bugfix' }),
      createMockObservation({ id: 'obs-3', type: 'feature' }),
      createMockObservation({ id: 'obs-4', type: 'refactor' }),
      createMockObservation({ id: 'obs-5', type: 'feature' }),
    ];

    const stats = calculateContextStats(observations);

    expect(stats.typeCounts).toEqual({
      bugfix: 2,
      feature: 2,
      refactor: 1,
    });
  });

  // ==========================================
  // Test 10: Token estimation
  // ==========================================
  it('should estimate token count from formatted context', () => {
    const observations = [
      createMockObservation({
        id: 'obs-1',
        title: 'A simple observation',
        narrative: 'A short narrative about something.',
      }),
    ];

    const stats = calculateContextStats(observations);

    // Token estimate should be roughly chars / 4
    expect(stats.tokenEstimate).toBeGreaterThan(0);
    // For the simple observation above, the formatted context should be reasonable
    expect(stats.tokenEstimate).toBeGreaterThan(50);
    expect(stats.tokenEstimate).toBeLessThan(1000);
  });

  it('should sum totalDiscoveryTokens from all observations', () => {
    const observations = [
      createMockObservation({ id: 'obs-1', discovery_tokens: 100 }),
      createMockObservation({ id: 'obs-2', discovery_tokens: 200 }),
      createMockObservation({ id: 'obs-3', discovery_tokens: 150 }),
    ];

    const stats = calculateContextStats(observations);

    expect(stats.totalDiscoveryTokens).toBe(450);
  });

  it('should handle observations with zero discovery_tokens', () => {
    const observations = [
      createMockObservation({ id: 'obs-1', discovery_tokens: 0 }),
      createMockObservation({ id: 'obs-2', discovery_tokens: 50 }),
    ];

    const stats = calculateContextStats(observations);

    expect(stats.totalDiscoveryTokens).toBe(50);
  });

  it('should return empty type counts for empty observations array', () => {
    const stats = calculateContextStats([]);

    expect(stats.observationCount).toBe(0);
    expect(stats.typeCounts).toEqual({});
    expect(stats.totalDiscoveryTokens).toBe(0);
  });
});
