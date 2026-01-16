/**
 * Context formatter for SessionHub observations
 * Formats observations from the database into markdown context for injection
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
  created_at: string;
  updated_at: string;
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
  } = options;

  if (observations.length === 0) {
    return '# Project Memory\n\nNo observations recorded yet.';
  }

  let output = '';

  // Header
  const projectTitle = projectName ? ` (${projectName})` : '';
  output += `# Project Memory${projectTitle}\n\n`;
  output += `${observations.length} observation${observations.length === 1 ? '' : 's'} recorded from your recent work.\n\n`;

  // Summary table (compact view of all observations)
  if (includeTable) {
    output += '## Overview\n\n';
    output += '| # | Type | Title | Files | Date |\n';
    output += '|---|------|-------|-------|------|\n';

    for (let i = 0; i < observations.length; i++) {
      output += formatTableRow(observations[i], i) + '\n';
    }

    output += '\n';
  }

  // Full details for top N observations
  if (includeFullDetails && observations.length > 0) {
    const detailCount = Math.min(topN, observations.length);
    output += `## Recent Details (Top ${detailCount})\n\n`;

    for (let i = 0; i < detailCount; i++) {
      output += formatFullObservation(observations[i], i);
    }

    // Add note if there are more observations not shown in detail
    if (observations.length > detailCount) {
      output += `*${observations.length - detailCount} more observation${observations.length - detailCount === 1 ? '' : 's'} available (see overview table above)*\n\n`;
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
