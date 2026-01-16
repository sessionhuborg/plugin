/**
 * Type definitions for the SessionHub plugin.
 */

import { z } from 'zod';

export const ProjectDataSchema = z.object({
  path: z.string(),
  name: z.string(),
  gitRemote: z.string().optional(),
  branch: z.string().optional(),
});

export type ProjectData = z.infer<typeof ProjectDataSchema>;

export interface SessionApiData {
  start_time: string;
  end_time?: string;
  project_path?: string;
  project_name?: string;
  name?: string;
  tool_name: string;
  git_branch?: string;
  input_tokens?: number;
  output_tokens?: number;
  cache_create_tokens?: number;
  cache_read_tokens?: number;
  metadata?: Record<string, any>;
  cwd?: string;
  tool?: string;
  capture_type?: string;
  todo_snapshots?: Array<{
    timestamp: string;
    todos: Array<{
      content: string;
      status: string;
      activeForm: string;
    }>;
  }>;
  plans?: Array<{
    timestamp: string;
    plan: string;
  }>;
  attachment_urls?: Array<{
    interactionIndex: number;
    type: string;
    storagePath: string;
    mediaType: string;
    filename: string;
    sizeBytes: number;
    uploadedAt: string;
    publicUrl?: string;
  }>;
  sub_sessions?: Array<{
    agentId: string;
    taskDescription: string | null;
    taskPrompt: string | null;
    interactionIndex: number;
    interactions: Array<{
      interaction_type: string;
      content: string;
      timestamp: string;
      metadata?: Record<string, any>;
    }>;
    messages: Array<{
      role: string;
      content: string;
      timestamp: string;
    }>;
    startTime: string;
    endTime: string | null;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
  }>;
  interactions: Array<{
    interaction_type: string;
    content: string;
    timestamp: string;
    tool_name: string;
    metadata: Record<string, any>;
  }>;
}

export interface ApiInteractionData {
  interaction_type: string;
  content: string;
  timestamp: string;
  tool_name: string;
  metadata: Record<string, any>;
  tokensUsed?: number;
  input_tokens?: number;
  output_tokens?: number;
}

export interface ModelUsageStats {
  models: string[];
  primaryModel: string | null;
  modelUsage: Record<string, number>;
  modelSwitches: number;
}

export interface PlanningModeInfo {
  hasPlanningMode: boolean;
  planningCycles: number;
  exitPlanTimestamps: Date[];
}

export interface EnhancedSessionData {
  projectName: string;
  projectPath: string;
  sessionId: string;
  startTime: string;
  endTime?: string;
  gitBranch?: string;
  interactions: any[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreateTokens: number;
  totalCacheReadTokens: number;
  modelInfo?: ModelUsageStats;
  planningModeInfo?: PlanningModeInfo;
  languages?: string[];
  sessionName?: string;
  cwd?: string;
  tool?: string;
  captureType?: string;
  todoSnapshots?: Array<{
    timestamp: string;
    todos: any[];
  }>;
  plans?: Array<{
    timestamp: string;
    plan: string;
  }>;
  attachmentUrls?: Array<{
    interactionIndex: number;
    type: string;
    storagePath: string;
    mediaType: string;
    filename: string;
    sizeBytes: number;
    uploadedAt: string;
    publicUrl?: string;
  }>;
  agentIdMap?: Map<string, {
    interactionIndex: number;
    taskDescription: string | null;
    taskPrompt: string | null;
  }>;
  subSessions?: SubSessionData[];
}

export interface SubSessionData {
  agentId: string;
  taskDescription: string | null;
  taskPrompt: string | null;
  interactionIndex: number;
  interactions: Array<{
    interaction_type: string;
    content: string;
    timestamp: string;
    metadata?: Record<string, any>;
  }>;
  messages: Array<{
    role: string;
    content: string;
    timestamp: string;
  }>;
  startTime: string;
  endTime: string | null;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
}

export interface UserInfo {
  userId: string;
  email: string;
  subscriptionTier: string;
}
