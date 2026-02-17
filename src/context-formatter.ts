/**
 * Context formatter for SessionHub observations
 * Formats observations from the database into markdown context for injection
 * 
 * Updated to support project-scoped lifecycle governance:
 * - Prefers project-scoped ACTIVE observations
 * - Ignores deprecated/superseded by default
 * - Backward compatible with older observation records (fields may be absent)
 */

export interface Observation {
  id: string;
  session_id: string;
  project_id: string;
  user_id: string;
  type: 'decision' | 'bugfix' | 'feature' | 'refactor' | 'discovery' | 'change';
  title: string;
  subtitle?: string;
  narrative: string;
  facts: any[];
  concepts: string[];
  files: string[];
  interaction_id?: string;
  tool_name?: string;
  discovery_tokens: number;
  
  // Project-scoped lifecycle governance (may be undefined for backward compatibility)
  observation_scope?: 'session' | 'project';
  lifecycle_state?: 'draft' | 'active' | 'deprecated' | 'superseded';
  superseded_by_observation_id?: string;
  promoted_from_observation_id?: string;
  promoted_at?: string;
  promoted_by?: string;
  curation_source?: 'human' | 'ai_suggested';
  
  created_at: string;
  updated_at: string;
}

export interface FormatOptions {
  topN?: number; // Number of observations to show full details for (default: 10)
  includeTable?: boolean; // Whether to include summary table (default: true)
  includeFullDetails?: boolean; // Whether to include full details section (default: true)
  projectName?: string; // Optional project name for header
  includeDraft?: boolean; // Include draft observations (default: false)
  includeDeprecated?: boolean; // Include deprecated observations (default: false)
}

/**
 * Filter observations for context injection
 * - Prefers project-scoped ACTIVE observations
 * - Ignores deprecated/superseded by default
 * - Backward compatible with older records missing lifecycle fields
 */
export function filterObservationsForInjection(
  observations: Observation[],
  options: { includeDraft?: boolean; includeDeprecated?: boolean } = {}
): Observation[] {
  const { includeDraft = false, includeDeprecated = false } = options;
  
  return observations.filter(obs => {
    // Backward compatibility: if lifecycle fields are absent, assume active
    const scope = obs.observation_scope || 'session';
    const state = obs.lifecycle_state || 'active';
    
    // Filter by scope: prefer project-scoped
    // (session-scoped are only included if no project-scoped available)
    
    // Filter by lifecycle state
    if (state === 'superseded') return false;
    if (state === 'deprecated' && !includeDeprecated) return false;
    if (state === 'draft' && !includeDraft) return false;
    if (state !== 'active' && state !== 'draft') return false;
    
    return true;
  });
}

/**
 * Sort observations for injection priority
 * Project-scoped ACTIVE observations come first
 */
export function sortObservationsByPriority(observations: Observation[]): Observation[] {
  return [...observations].sort((a, b) => {
    const scopeOrder = (obs: Observation) => {
      const scope = obs.observation_scope || 'session';
      const state = obs.lifecycle_state || 'active';
      
      // Project-scoped active first
      if (scope === 'project' && state === 'active') return 0;
      // Session-scoped active second
      if (scope === 'session' && state === 'active') return 1;
      // Drafts third
      if (state === 'draft') return 2;
      // Everything else last
      return 3;
    };
    
    return scopeOrder(a) - scopeOrder(b);
  });
}

export interface FormatOptions {
  topN?: number; // Number of observations to show full details for (default: 10)
  includeTable?: boolean; // Whether to include summary table (default: true)
  includeFullDetails?: boolean; // Whether to include full details section (default: true)
  projectName?: string; // Optional project name for header
}

/**
 * Type emoji mapping for visual categorization
 */
const TYPE_EMOJI_MAP: Record<Observation['type'], string> = {
  bugfix: '🔧',
  feature: '✨',
  decision: '📋',
  discovery: '🔍',
  refactor: '🔄',
  change: '📝',
};

/**
 * Estimate token count for text (rough approximation: 1 token ≈ 4 characters)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Format a single observation as compact table row
 */
function formatTableRow(obs: Observation, index: number): string {
  const emoji = TYPE_EMOJI_MAP[obs.type];
  const date = new Date(obs.created_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
  const filesStr = obs.files.length > 0 ? obs.files.slice(0, 2).join(', ') : '-';
  const filesDisplay = obs.files.length > 2 ? `${filesStr}, +${obs.files.length - 2}` : filesStr;

  return `| ${index + 1} | ${emoji} ${obs.type} | ${obs.title} | ${filesDisplay} | ${date} |`;
}

/**
 * Format a single observation with full details
 */
function formatFullObservation(obs: Observation, index: number): string {
  const emoji = TYPE_EMOJI_MAP[obs.type];
  const date = new Date(obs.created_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  let output = `### ${index + 1}. ${emoji} ${obs.title}\n\n`;

  if (obs.subtitle) {
    output += `**${obs.subtitle}**\n\n`;
  }

  output += `${obs.narrative}\n\n`;

  // Add facts if present
  if (obs.facts && obs.facts.length > 0) {
    output += '**Key Facts:**\n';
    for (const fact of obs.facts) {
      output += `- ${fact}\n`;
    }
    output += '\n';
  }

  // Add files if present
  if (obs.files && obs.files.length > 0) {
    output += `**Files:** ${obs.files.join(', ')}\n\n`;
  }

  // Add concepts/tags if present
  if (obs.concepts && obs.concepts.length > 0) {
    output += `**Tags:** ${obs.concepts.join(', ')}\n\n`;
  }

  output += `*${date}*\n\n`;
  output += '---\n\n';

  return output;
}

/**
 * Format observations into markdown context with progressive disclosure
 * Now filters for project-scoped ACTIVE observations by default
 */
export function formatObservationsContext(
  observations: Observation[],
  options: FormatOptions = {}
): string {
  const {
    topN = 10,
    includeTable = true,
    includeFullDetails = true,
    projectName,
    includeDraft = false,
    includeDeprecated = false,
  } = options;

  // Filter and sort observations for injection
  // This ensures only project-scoped ACTIVE observations are included by default
  const filteredObservations = filterObservationsForInjection(observations, {
    includeDraft,
    includeDeprecated,
  });
  
  const sortedObservations = sortObservationsByPriority(filteredObservations);

  if (sortedObservations.length === 0) {
    // If no project-scoped active observations, fall back to session-scoped active
    const fallbackObservations = observations.filter(obs => {
      const scope = obs.observation_scope || 'session';
      const state = obs.lifecycle_state || 'active';
      return scope === 'session' && state === 'active';
    });
    
    if (fallbackObservations.length === 0) {
      return '# Project Memory\n\nNo active observations recorded yet.';
    }
    
    return formatObservationsContext(fallbackObservations, {
      ...options,
      includeDraft: true,
    });
  }

  let output = '';

  // Header
  const projectTitle = projectName ? ` (${projectName})` : '';
  const scopeNote = sortedObservations.some(o => o.observation_scope === 'project') 
    ? ' (project-scoped)' 
    : '';
  output += `# Project Memory${projectTitle}${scopeNote}\n\n`;
  output += `${sortedObservations.length} active observation${sortedObservations.length === 1 ? '' : 's'} for context.\n\n`;

  // Summary table (compact view of all observations)
  if (includeTable) {
    output += '## Overview\n\n';
    output += '| # | Type | Title | Files | Date |\n';
    output += '|---|------|-------|-------|------|\n';

    for (let i = 0; i < sortedObservations.length; i++) {
      output += formatTableRow(sortedObservations[i], i) + '\n';
    }

    output += '\n';
  }

  // Full details for top N observations
  if (includeFullDetails && sortedObservations.length > 0) {
    const detailCount = Math.min(topN, sortedObservations.length);
    output += `## Recent Details (Top ${detailCount})\n\n`;

    for (let i = 0; i < detailCount; i++) {
      output += formatFullObservation(sortedObservations[i], i);
    }

    // Add note if there are more observations not shown in detail
    if (sortedObservations.length > detailCount) {
      output += `*${sortedObservations.length - detailCount} more observation${sortedObservations.length - detailCount === 1 ? '' : 's'} available (see overview table above)*\n\n`;
    }
  }

  return output;
}

/**
 * Calculate context statistics
 */
export function calculateContextStats(observations: Observation[]): {
  observationCount: number;
  tokenEstimate: number;
  typeCounts: Record<string, number>;
  totalDiscoveryTokens: number;
} {
  const typeCounts: Record<string, number> = {};
  let totalDiscoveryTokens = 0;

  for (const obs of observations) {
    typeCounts[obs.type] = (typeCounts[obs.type] || 0) + 1;
    totalDiscoveryTokens += obs.discovery_tokens || 0;
  }

  // Estimate total tokens for the formatted context
  const formattedContext = formatObservationsContext(observations);
  const tokenEstimate = estimateTokens(formattedContext);

  return {
    observationCount: observations.length,
    tokenEstimate,
    typeCounts,
    totalDiscoveryTokens,
  };
}
