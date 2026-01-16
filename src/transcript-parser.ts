/**
 * Transcript parser for Claude Code JSONL files.
 * Extracts sessions, interactions, tools, tokens, and metadata.
 */

import { homedir } from 'os';
import { logger } from './logger.js';
import type { AttachmentMetadata } from './storage-uploader.js';
import type { EnhancedSessionData, ModelUsageStats, PlanningModeInfo, SubSessionData, UserInfo } from './models.js';
import type { GrpcAPIClient } from './grpc-client.js';

export class TranscriptParser {
  private currentUser?: UserInfo;
  private grpcClient?: GrpcAPIClient;

  constructor(options?: { currentUser?: UserInfo; grpcClient?: GrpcAPIClient }) {
    this.currentUser = options?.currentUser;
    this.grpcClient = options?.grpcClient;
  }

  setGrpcClient(client: GrpcAPIClient): void {
    this.grpcClient = client;
  }

  setCurrentUser(user: UserInfo): void {
    this.currentUser = user;
  }

  /**
   * Extract base64-encoded images from message content
   */
  private extractImagesFromContent(messageContent: any[]): Array<{
    base64Data: string;
    mediaType: string;
  }> {
    const images: Array<{ base64Data: string; mediaType: string }> = [];

    if (!Array.isArray(messageContent)) {
      return images;
    }

    for (const item of messageContent) {
      if (
        item.type === 'image' &&
        item.source?.type === 'base64' &&
        item.source?.data &&
        item.source?.media_type
      ) {
        images.push({
          base64Data: item.source.data,
          mediaType: item.source.media_type,
        });
      }
    }

    return images;
  }

  /**
   * Replace image content with references to uploaded attachments.
   * Each base64 image is replaced with a sequential attachment index starting from startIndex.
   */
  private replaceImagesWithReferences(messageContent: any[], startIndex: number): any[] {
    let currentIndex = startIndex;
    return messageContent.map((item) => {
      if (
        item.type === 'image' &&
        item.source?.type === 'base64'
      ) {
        return {
          type: 'image_ref',
          attachment_index: currentIndex++,
        };
      }
      return item;
    });
  }

  async quickExtractTimestamp(filePath: string): Promise<Date | null> {
    const fs = await import('fs/promises');
    let fd: Awaited<ReturnType<typeof fs.open>> | null = null;

    try {
      // Read 64KB to handle files with large early lines (e.g., huge user messages)
      fd = await fs.open(filePath, 'r');
      const buffer = Buffer.alloc(65536);
      const { bytesRead } = await fd.read(buffer, 0, 65536, 0);

      if (bytesRead === 0) return null;

      const content = buffer.toString('utf-8', 0, bytesRead);

      // Use regex to find timestamp - works even with partial/truncated JSON lines
      const match = content.match(/"timestamp"\s*:\s*"([^"]+)"/);
      if (match) {
        return new Date(match[1]);
      }

      return null;
    } catch {
      return null;
    } finally {
      // Always close file descriptor to prevent leaks
      if (fd) {
        await fd.close().catch(() => {});
      }
    }
  }

  async quickExtractSessionId(filePath: string): Promise<string | null> {
    const fs = await import('fs/promises');
    let fd: Awaited<ReturnType<typeof fs.open>> | null = null;

    try {
      // Read 64KB to handle files with large early lines (e.g., huge user messages)
      fd = await fs.open(filePath, 'r');
      const buffer = Buffer.alloc(65536);
      const { bytesRead } = await fd.read(buffer, 0, 65536, 0);

      if (bytesRead === 0) return null;

      const content = buffer.toString('utf-8', 0, bytesRead);

      // Use regex to find sessionId - works even with partial/truncated JSON lines
      const match = content.match(/"sessionId"\s*:\s*"([a-f0-9-]{36})"/);
      if (match) {
        return match[1];
      }

      return null;
    } catch {
      return null;
    } finally {
      // Always close file descriptor to prevent leaks
      if (fd) {
        await fd.close().catch(() => {});
      }
    }
  }

  private extractLanguagesFromSession(lines: string[]): string[] {
    const languages = new Set<string>();

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);

        if (entry.toolUseResult?.filePath) {
          const filePath = entry.toolUseResult.filePath.toLowerCase();
          this.addLanguageFromFilePath(filePath, languages);
        }

        if (entry.tool_input?.file_path) {
          const filePath = entry.tool_input.file_path.toLowerCase();
          this.addLanguageFromFilePath(filePath, languages);
        }

        if (entry.message?.content && Array.isArray(entry.message.content)) {
          for (const item of entry.message.content) {
            if (item.type === 'tool_use' && item.input?.file_path) {
              const filePath = item.input.file_path.toLowerCase();
              this.addLanguageFromFilePath(filePath, languages);
            }
          }
        }
      } catch {
        continue;
      }
    }

    return Array.from(languages);
  }

  private addLanguageFromFilePath(filePath: string, languages: Set<string>): void {
    if (filePath.endsWith('.js') || filePath.endsWith('.jsx')) languages.add('javascript');
    else if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) languages.add('typescript');
    else if (filePath.endsWith('.py')) languages.add('python');
    else if (filePath.endsWith('.java')) languages.add('java');
    else if (filePath.endsWith('.sol')) languages.add('solidity');
    else if (filePath.endsWith('.go')) languages.add('go');
    else if (filePath.endsWith('.rs')) languages.add('rust');
    else if (filePath.endsWith('.c') && !filePath.endsWith('.cc')) languages.add('c');
    else if (filePath.endsWith('.cpp') || filePath.endsWith('.cc') || filePath.endsWith('.cxx')) languages.add('cpp');
    else if (filePath.endsWith('.swift')) languages.add('swift');
    else if (filePath.endsWith('.kt') || filePath.endsWith('.kts')) languages.add('kotlin');
    else if (filePath.endsWith('.php')) languages.add('php');
    else if (filePath.endsWith('.rb')) languages.add('ruby');
    else if (filePath.endsWith('.sh') || filePath.endsWith('.bash')) languages.add('shell');
    else if (filePath.endsWith('.sql')) languages.add('sql');
    else if (filePath.endsWith('.html') || filePath.endsWith('.htm')) languages.add('html');
    else if (filePath.endsWith('.css') || filePath.endsWith('.scss') || filePath.endsWith('.sass')) languages.add('css');
  }

  private filterLastExchanges(
    interactions: any[],
    count: number
  ): { interactions: any[]; startIndex: number } {
    const exchangeStarts: number[] = [];
    for (let i = 0; i < interactions.length; i++) {
      if (interactions[i].interaction_type === 'prompt') {
        exchangeStarts.push(i);
      }
    }

    if (exchangeStarts.length === 0 || count >= exchangeStarts.length) {
      return { interactions, startIndex: 0 };
    }

    const startFrom = exchangeStarts[exchangeStarts.length - count];

    return {
      interactions: interactions.slice(startFrom),
      startIndex: startFrom,
    };
  }

  async parseTranscriptFile(filePath: string, lastExchanges?: number): Promise<EnhancedSessionData | null> {
    try {
      const fs = await import('fs/promises');
      const path = await import('path');

      // Check file size before loading to prevent OOM on very large files
      const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB limit
      const stats = await fs.stat(filePath);
      if (stats.size > MAX_FILE_SIZE) {
        logger.error(`Transcript file too large: ${stats.size} bytes (max ${MAX_FILE_SIZE}). Skipping.`);
        return null;
      }

      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim());

      if (lines.length === 0) {
        return null;
      }

      const interactions: any[] = [];
      const toolCallMap = new Map<string, any>();
      const agentIdMap = new Map<string, { interactionIndex: number; taskDescription: string | null; taskPrompt: string | null }>();
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let totalCacheCreateTokens = 0;
      let totalCacheReadTokens = 0;
      let sessionId = '';
      let startTime = '';
      let endTime = '';
      let projectPath = '';
      let gitBranch = '';

      let sessionCwd = '';
      let sessionTool = 'claude-code';
      let sessionCaptureType = 'batch_import';

      const modelStats: Record<string, number> = {};
      let lastModel: string | null = null;
      let modelSwitches = 0;

      const exitPlanTimestamps: Date[] = [];
      const plans: Array<{timestamp: string; plan: string}> = [];
      const todoSnapshots: Array<{timestamp: string; todos: any[]}> = [];
      const attachmentUrls: AttachmentMetadata[] = [];

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);

          if (!sessionId && entry.sessionId) {
            sessionId = entry.sessionId;
            projectPath = entry.cwd || process.cwd();
            gitBranch = entry.gitBranch || 'main';
            startTime = entry.timestamp;
            sessionCwd = entry.cwd || process.cwd();
            if (entry.tool) sessionTool = entry.tool;
          }

          if (entry.timestamp) {
            endTime = entry.timestamp;
          }

          if (entry.type === 'user' && entry.message?.role === 'user') {
            // Extract and upload images via backend if gRPC client is available
            if (Array.isArray(entry.message.content) && this.grpcClient && sessionId) {
              const images = this.extractImagesFromContent(entry.message.content);

              if (images.length > 0) {
                logger.info(`Found ${images.length} image(s) in user message, uploading via backend...`);

                // Track the starting attachment index before uploads
                const attachmentStartIndex = attachmentUrls.length;

                for (let i = 0; i < images.length; i++) {
                  const image = images[i];
                  const currentInteractionIndex = interactions.length;

                  try {
                    const result = await this.grpcClient.uploadAttachment(
                      sessionId,
                      currentInteractionIndex,
                      image.base64Data,
                      image.mediaType
                    );

                    if (result.success && result.storagePath && result.publicUrl) {
                      attachmentUrls.push({
                        type: 'image',
                        storagePath: result.storagePath,
                        publicUrl: result.publicUrl,
                        mediaType: image.mediaType,
                        filename: result.storagePath.split('/').pop() || 'image',
                        sizeBytes: Math.ceil(image.base64Data.length * 0.75), // Approximate size from base64
                        interactionIndex: currentInteractionIndex,
                        uploadedAt: new Date().toISOString(),
                      });
                      logger.info(`Image ${i + 1}/${images.length} uploaded: ${result.storagePath}`);
                    } else {
                      logger.warn(`Failed to upload image ${i + 1}/${images.length}: ${result.error}`);
                      // Continue to next image - don't fail entire import
                    }
                  } catch (uploadError) {
                    logger.error(`Exception uploading image ${i + 1}/${images.length}: ${uploadError}`);
                    // Continue to next image - don't fail entire import
                  }
                }

                // Replace image content with sequential references starting from the first uploaded attachment
                entry.message.content = this.replaceImagesWithReferences(
                  entry.message.content,
                  attachmentStartIndex
                );
              }
            }

            if (Array.isArray(entry.message.content)) {
              for (const contentItem of entry.message.content) {
                if (contentItem.type === 'tool_result' && contentItem.tool_use_id) {
                  const toolCall = toolCallMap.get(contentItem.tool_use_id);
                  if (toolCall) {
                    const toolName = toolCall.metadata.tool_name;

                    if (toolName === 'Task' && entry.toolUseResult?.agentId) {
                      const agentId = entry.toolUseResult.agentId;
                      const taskDescription = toolCall.metadata.tool_input?.description || null;
                      const taskPrompt = toolCall.metadata.tool_input?.prompt || null;

                      agentIdMap.set(agentId, {
                        interactionIndex: interactions.length,
                        taskDescription,
                        taskPrompt,
                      });

                      logger.info(`Detected sub-agent: ${agentId}`);
                    }

                    const isCodeEditingTool = ['Edit', 'Write', 'MultiEdit'].includes(toolName);
                    const isWebSearch = toolName === 'WebSearch';
                    const isExitPlanMode = toolName === 'ExitPlanMode';

                    if (isExitPlanMode && toolCall.metadata.tool_input?.plan) {
                      plans.push({
                        timestamp: entry.timestamp,
                        plan: toolCall.metadata.tool_input.plan
                      });
                      continue;
                    }

                    if (isCodeEditingTool && entry.toolUseResult) {
                      const postToolUseInteraction = {
                        interaction_type: 'tool_call',
                        content: `Tool completed: ${toolName}`,
                        timestamp: entry.timestamp,
                        metadata: {
                          tool_name: toolName,
                          hook_event: 'PostToolUse',
                          tool_response: {
                            filePath: entry.toolUseResult.filePath,
                            structuredPatch: entry.toolUseResult.structuredPatch,
                            ...(toolName === 'Edit' && {
                              oldString: entry.toolUseResult.oldString,
                              newString: entry.toolUseResult.newString,
                            }),
                          },
                        },
                      };

                      interactions.push(postToolUseInteraction);
                    } else if (isWebSearch && entry.toolUseResult) {
                      const postToolUseInteraction = {
                        interaction_type: 'tool_call',
                        content: `WebSearch completed: ${toolCall.metadata.tool_input?.query || 'query'}`,
                        timestamp: entry.timestamp,
                        metadata: {
                          tool_name: toolName,
                          hook_event: 'PostToolUse',
                          tool_response: {
                            query: entry.toolUseResult.query,
                            results: entry.toolUseResult.results,
                          },
                        },
                      };

                      interactions.push(postToolUseInteraction);
                    }
                  }
                  continue;
                }
              }
            }

            const userContent = Array.isArray(entry.message.content)
              ? entry.message.content
                  .filter((c: any) => c.type === 'text' || typeof c === 'string')
                  .map((c: any) => c.text || c || '')
                  .join('\n')
                  .trim()
              : entry.message.content || '';

            const isSystemMessage = userContent && (
              userContent.startsWith('<command-name>') ||
              userContent.includes('<local-command-stdout>') ||
              userContent.includes('<local-command-stderr>') ||
              userContent.includes('<system-reminder>') ||
              userContent.includes('Error opening memory file') ||
              userContent.includes('Cancelled memory editing') ||
              userContent.startsWith('Caveat: The messages below were generated by the user while running local commands.')
            );

            if (userContent && !isSystemMessage) {
              interactions.push({
                interaction_type: 'prompt',
                content: userContent,
                timestamp: entry.timestamp,
              });
            }
          }

          if (entry.type === 'assistant' && entry.message?.role === 'assistant') {
            const contentItems = entry.message.content || [];
            const textItems = Array.isArray(contentItems)
              ? contentItems
                  .filter((item: any) => item.type === 'text' && item.text)
                  .map((item: any) => item.text)
              : [];

            if (textItems.length > 0) {
              const responseContent = textItems.join('\n').trim();

              // Include token usage in metadata for --last flag filtering
              const usage = entry.message.usage || {};
              interactions.push({
                interaction_type: 'response',
                content: responseContent,
                timestamp: entry.timestamp,
                metadata: {
                  input_tokens: usage.input_tokens || 0,
                  output_tokens: usage.output_tokens || 0,
                  cache_creation_input_tokens: usage.cache_creation_input_tokens || 0,
                  cache_read_input_tokens: usage.cache_read_input_tokens || 0,
                },
              });
            }

            if (entry.message.model) {
              modelStats[entry.message.model] = (modelStats[entry.message.model] || 0) + 1;

              if (lastModel && lastModel !== entry.message.model) {
                modelSwitches++;
              }
              lastModel = entry.message.model;
            }

            if (Array.isArray(contentItems)) {
              for (const item of contentItems) {
                if (item.type === 'tool_use' && item.name === 'ExitPlanMode') {
                  exitPlanTimestamps.push(new Date(entry.timestamp));
                  if (item.input?.plan) {
                    plans.push({
                      timestamp: entry.timestamp,
                      plan: item.input.plan
                    });
                  }
                }

                if (item.type === 'tool_use' && item.name === 'TodoWrite' && item.input?.todos && Array.isArray(item.input.todos)) {
                  todoSnapshots.push({
                    timestamp: entry.timestamp,
                    todos: item.input.todos
                  });
                }
              }
            }

            const toolUseItems = Array.isArray(contentItems)
              ? contentItems.filter((item: any) => item.type === 'tool_use')
              : [];

            for (const toolUseItem of toolUseItems) {
              const toolName = toolUseItem.name || 'Unknown Tool';
              const toolInput = toolUseItem.input || {};
              const toolId = toolUseItem.id;

              if (toolName === 'TodoWrite' || toolName === 'ExitPlanMode') {
                continue;
              }

              let essentialToolInput: any = undefined;

              if (['Edit', 'Write', 'MultiEdit'].includes(toolName)) {
                essentialToolInput = {
                  file_path: toolInput.file_path,
                };
                if (toolName === 'Write' && toolInput.content) {
                  essentialToolInput.content = toolInput.content;
                }
                if (toolName === 'Edit') {
                  essentialToolInput.old_string = toolInput.old_string;
                  essentialToolInput.new_string = toolInput.new_string;
                }
                if (toolName === 'MultiEdit' && toolInput.edits) {
                  essentialToolInput.edits = toolInput.edits;
                }
              } else if (toolName === 'Bash' && toolInput.command) {
                essentialToolInput = {
                  command: toolInput.command,
                };
              } else if (toolName === 'Grep' && toolInput.pattern) {
                essentialToolInput = {
                  pattern: toolInput.pattern,
                  ...(toolInput.path && { path: toolInput.path }),
                };
              } else if (toolName === 'Glob' && toolInput.pattern) {
                essentialToolInput = {
                  pattern: toolInput.pattern,
                  ...(toolInput.path && { path: toolInput.path }),
                };
              } else if (toolName === 'Read' && toolInput.file_path) {
                essentialToolInput = {
                  file_path: toolInput.file_path,
                };
              } else if (toolName === 'WebSearch' && toolInput.query) {
                essentialToolInput = {
                  query: toolInput.query,
                };
              } else {
                const commonFields: Record<string, any> = {};

                if (toolInput.description) {
                  commonFields.description = toolInput.description.substring(0, 300);
                }
                if (toolInput.prompt) {
                  commonFields.prompt = toolInput.prompt.substring(0, 500);
                }
                if (toolInput.command) {
                  commonFields.command = toolInput.command;
                }
                if (toolInput.query) {
                  commonFields.query = toolInput.query.substring(0, 500);
                }
                if (toolInput.questions) {
                  commonFields.questions = toolInput.questions;
                }
                if (toolInput.subagent_type) {
                  commonFields.subagent_type = toolInput.subagent_type;
                }

                if (toolName.startsWith('mcp__')) {
                  Object.keys(toolInput).forEach(key => {
                    if (commonFields[key]) return;

                    const value = toolInput[key];
                    if (typeof value === 'string' && value.length < 1000) {
                      commonFields[key] = value;
                    } else if (typeof value === 'number' || typeof value === 'boolean') {
                      commonFields[key] = value;
                    } else if (Array.isArray(value) && value.length < 10) {
                      commonFields[key] = value;
                    }
                  });
                }

                if (Object.keys(commonFields).length > 0) {
                  essentialToolInput = commonFields;
                }
              }

              const toolCallInteraction = {
                interaction_type: 'tool_call',
                content: `Tool: ${toolName}`,
                timestamp: entry.timestamp,
                metadata: {
                  tool_name: toolName,
                  ...(essentialToolInput && { tool_input: essentialToolInput }),
                  hook_event: 'PreToolUse',
                },
              };

              interactions.push(toolCallInteraction);

              if (toolId) {
                toolCallMap.set(toolId, toolCallInteraction);
              }
            }

            const usage = entry.message.usage || {};
            totalInputTokens += usage.input_tokens || 0;
            totalCacheCreateTokens += usage.cache_creation_input_tokens || 0;
            totalCacheReadTokens += usage.cache_read_input_tokens || 0;
            totalOutputTokens += usage.output_tokens || 0;
          }

          if (entry.type === 'tool' || entry.hook_event === 'PreToolUse') {
            const toolName = entry.tool_name || entry.tool?.name || 'Unknown Tool';

            if (toolName === 'TodoWrite' || toolName === 'ExitPlanMode') {
              continue;
            }

            const toolMetadata: Record<string, any> = {
              tool_name: toolName,
              hook_event: entry.hook_event || 'PreToolUse',
            };

            if (entry.tool_input) {
              toolMetadata['tool_input'] = entry.tool_input;
            }

            const interaction = {
              interaction_type: 'tool_call',
              content: `Tool: ${toolName}`,
              timestamp: entry.timestamp,
              metadata: toolMetadata,
            };

            interactions.push(interaction);

            if (entry.tool_use_id) {
              toolCallMap.set(entry.tool_use_id, interaction);
            }
          }
        } catch (jsonError) {
          logger.warn('Failed to parse line in transcript:', jsonError);
          continue;
        }
      }

      const projectName = path.basename(projectPath);
      const languages = this.extractLanguagesFromSession(lines);

      let modelInfo: ModelUsageStats | undefined = undefined;
      if (Object.keys(modelStats).length > 0) {
        const models = Object.keys(modelStats);
        const primaryModel = models.reduce((a, b) =>
          modelStats[a] > modelStats[b] ? a : b
        );

        modelInfo = {
          models,
          primaryModel,
          modelUsage: modelStats,
          modelSwitches,
        };
      }

      let planningModeInfo: PlanningModeInfo | undefined = undefined;
      if (exitPlanTimestamps.length > 0) {
        planningModeInfo = {
          hasPlanningMode: true,
          planningCycles: exitPlanTimestamps.length,
          exitPlanTimestamps: exitPlanTimestamps,
        };
      }

      let filteredInteractions = interactions;
      let filteredStartTime = startTime;
      let filteredTotalInputTokens = totalInputTokens;
      let filteredTotalOutputTokens = totalOutputTokens;
      let filteredTotalCacheCreateTokens = totalCacheCreateTokens;
      let filteredTotalCacheReadTokens = totalCacheReadTokens;

      if (lastExchanges && lastExchanges > 0) {
        const filterResult = this.filterLastExchanges(interactions, lastExchanges);
        filteredInteractions = filterResult.interactions;

        if (filteredInteractions.length > 0 && filteredInteractions[0].timestamp) {
          filteredStartTime = filteredInteractions[0].timestamp;
        }

        filteredTotalInputTokens = 0;
        filteredTotalOutputTokens = 0;
        filteredTotalCacheCreateTokens = 0;
        filteredTotalCacheReadTokens = 0;

        for (const interaction of filteredInteractions) {
          if (interaction.metadata) {
            filteredTotalInputTokens += interaction.metadata.input_tokens || 0;
            filteredTotalOutputTokens += interaction.metadata.output_tokens || 0;
            filteredTotalCacheCreateTokens += interaction.metadata.cache_creation_input_tokens || 0;
            filteredTotalCacheReadTokens += interaction.metadata.cache_read_input_tokens || 0;
          }
        }

        logger.info(`Filtered to last ${lastExchanges} exchanges: ${filteredInteractions.length} interactions`);
      }

      return {
        projectName,
        projectPath,
        sessionId,
        startTime: filteredStartTime,
        endTime,
        gitBranch,
        interactions: filteredInteractions,
        totalInputTokens: filteredTotalInputTokens,
        totalOutputTokens: filteredTotalOutputTokens,
        totalCacheCreateTokens: filteredTotalCacheCreateTokens,
        totalCacheReadTokens: filteredTotalCacheReadTokens,
        modelInfo,
        planningModeInfo,
        languages,
        cwd: sessionCwd,
        tool: sessionTool,
        captureType: sessionCaptureType,
        todoSnapshots,
        plans,
        attachmentUrls,
        agentIdMap,
      };
    } catch (error) {
      console.error('Failed to parse transcript file:', error);
      return null;
    }
  }

  async parseSubAgentFile(
    filePath: string,
    agentId: string,
    taskDescription: string | null,
    taskPrompt: string | null,
    interactionIndex: number
  ): Promise<SubSessionData | null> {
    try {
      const fs = await import('fs/promises');

      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim());

      if (lines.length === 0) {
        return null;
      }

      const interactions: Array<any> = [];
      const messages: Array<{ role: string; content: string; timestamp: string }> = [];
      const toolCallMap = new Map<string, any>();

      let inputTokens = 0;
      let outputTokens = 0;
      let startTime = '';
      let endTime = '';

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);

          if (!startTime && entry.timestamp) {
            startTime = entry.timestamp;
          }

          if (entry.timestamp) {
            endTime = entry.timestamp;
          }

          if (entry.type === 'user' && entry.message?.role === 'user') {
            if (Array.isArray(entry.message.content)) {
              for (const contentItem of entry.message.content) {
                if (contentItem.type === 'tool_result' && contentItem.tool_use_id) {
                  const toolCall = toolCallMap.get(contentItem.tool_use_id);
                  if (toolCall) {
                    const toolName = toolCall.metadata.tool_name;

                    const isCodeEditingTool = ['Edit', 'Write', 'MultiEdit'].includes(toolName);
                    const isWebSearch = toolName === 'WebSearch';

                    if (isCodeEditingTool && entry.toolUseResult) {
                      const postToolUseInteraction = {
                        interaction_type: 'tool_call',
                        content: `Tool completed: ${toolName}`,
                        timestamp: entry.timestamp,
                        metadata: {
                          tool_name: toolName,
                          hook_event: 'PostToolUse',
                          tool_response: {
                            filePath: entry.toolUseResult.filePath,
                            structuredPatch: entry.toolUseResult.structuredPatch,
                            ...(toolName === 'Edit' && {
                              oldString: entry.toolUseResult.oldString,
                              newString: entry.toolUseResult.newString,
                            }),
                          },
                        },
                      };

                      interactions.push(postToolUseInteraction);
                    } else if (isWebSearch && entry.toolUseResult) {
                      const postToolUseInteraction = {
                        interaction_type: 'tool_call',
                        content: `WebSearch completed: ${toolCall.metadata.tool_input?.query || 'query'}`,
                        timestamp: entry.timestamp,
                        metadata: {
                          tool_name: toolName,
                          hook_event: 'PostToolUse',
                          tool_response: {
                            query: entry.toolUseResult.query,
                            results: entry.toolUseResult.results,
                          },
                        },
                      };

                      interactions.push(postToolUseInteraction);
                    }
                  }
                  continue;
                }
              }
            }

            const userContent = Array.isArray(entry.message.content)
              ? entry.message.content
                  .filter((c: any) => c.type === 'text' || typeof c === 'string')
                  .map((c: any) => c.text || c || '')
                  .join('\n')
                  .trim()
              : entry.message.content || '';

            const isSystemMessage = userContent && (
              userContent.startsWith('<command-name>') ||
              userContent.includes('<local-command-stdout>') ||
              userContent.includes('<local-command-stderr>') ||
              userContent.includes('<system-reminder>') ||
              userContent.includes('Error opening memory file') ||
              userContent.includes('Cancelled memory editing')
            );

            if (userContent && !isSystemMessage) {
              interactions.push({
                interaction_type: 'prompt',
                content: userContent,
                timestamp: entry.timestamp,
              });

              messages.push({
                role: 'user',
                content: userContent,
                timestamp: entry.timestamp,
              });
            }
          }

          if (entry.type === 'assistant' && entry.message?.role === 'assistant') {
            const contentItems = entry.message.content || [];
            const textItems = Array.isArray(contentItems)
              ? contentItems
                  .filter((item: any) => item.type === 'text' && item.text)
                  .map((item: any) => item.text)
              : [];

            if (textItems.length > 0) {
              const responseContent = textItems.join('\n').trim();

              // Include token usage in metadata for --last flag filtering
              const usage = entry.message.usage || {};
              interactions.push({
                interaction_type: 'response',
                content: responseContent,
                timestamp: entry.timestamp,
                metadata: {
                  input_tokens: usage.input_tokens || 0,
                  output_tokens: usage.output_tokens || 0,
                  cache_creation_input_tokens: usage.cache_creation_input_tokens || 0,
                  cache_read_input_tokens: usage.cache_read_input_tokens || 0,
                },
              });

              messages.push({
                role: 'assistant',
                content: responseContent,
                timestamp: entry.timestamp,
              });
            }

            const toolUseItems = Array.isArray(contentItems)
              ? contentItems.filter((item: any) => item.type === 'tool_use')
              : [];

            for (const toolUseItem of toolUseItems) {
              const toolName = toolUseItem.name || 'Unknown Tool';
              const toolInput = toolUseItem.input || {};
              const toolId = toolUseItem.id;

              let essentialToolInput: any = undefined;

              if (['Edit', 'Write', 'MultiEdit'].includes(toolName)) {
                essentialToolInput = {
                  file_path: toolInput.file_path,
                };
                if (toolName === 'Write' && toolInput.content) {
                  essentialToolInput.content = toolInput.content;
                }
                if (toolName === 'Edit') {
                  essentialToolInput.old_string = toolInput.old_string;
                  essentialToolInput.new_string = toolInput.new_string;
                }
                if (toolName === 'MultiEdit' && toolInput.edits) {
                  essentialToolInput.edits = toolInput.edits;
                }
              } else if (toolName === 'Bash' && toolInput.command) {
                essentialToolInput = {
                  command: toolInput.command,
                };
              } else if (toolName === 'Grep' && toolInput.pattern) {
                essentialToolInput = {
                  pattern: toolInput.pattern,
                  ...(toolInput.path && { path: toolInput.path }),
                };
              } else if (toolName === 'Glob' && toolInput.pattern) {
                essentialToolInput = {
                  pattern: toolInput.pattern,
                  ...(toolInput.path && { path: toolInput.path }),
                };
              } else if (toolName === 'Read' && toolInput.file_path) {
                essentialToolInput = {
                  file_path: toolInput.file_path,
                };
              } else if (toolName === 'WebSearch' && toolInput.query) {
                essentialToolInput = {
                  query: toolInput.query,
                };
              } else {
                const commonFields: Record<string, any> = {};

                if (toolInput.description) {
                  commonFields.description = toolInput.description.substring(0, 300);
                }
                if (toolInput.prompt) {
                  commonFields.prompt = toolInput.prompt.substring(0, 500);
                }
                if (toolInput.command) {
                  commonFields.command = toolInput.command;
                }
                if (toolInput.query) {
                  commonFields.query = toolInput.query.substring(0, 500);
                }

                if (toolName.startsWith('mcp__')) {
                  Object.keys(toolInput).forEach(key => {
                    if (commonFields[key]) return;

                    const value = toolInput[key];
                    if (typeof value === 'string' && value.length < 1000) {
                      commonFields[key] = value;
                    } else if (typeof value === 'number' || typeof value === 'boolean') {
                      commonFields[key] = value;
                    } else if (Array.isArray(value) && value.length < 10) {
                      commonFields[key] = value;
                    }
                  });
                }

                if (Object.keys(commonFields).length > 0) {
                  essentialToolInput = commonFields;
                }
              }

              const toolCallInteraction = {
                interaction_type: 'tool_call',
                content: `Tool: ${toolName}`,
                timestamp: entry.timestamp,
                metadata: {
                  tool_name: toolName,
                  ...(essentialToolInput && { tool_input: essentialToolInput }),
                  hook_event: 'PreToolUse',
                },
              };

              interactions.push(toolCallInteraction);

              if (toolId) {
                toolCallMap.set(toolId, toolCallInteraction);
              }
            }

            const usage = entry.message.usage || {};
            inputTokens += usage.input_tokens || 0;
            outputTokens += usage.output_tokens || 0;
          }

          if (entry.type === 'tool' || entry.hook_event === 'PreToolUse') {
            const toolName = entry.tool_name || entry.tool?.name || 'Unknown Tool';

            const toolMetadata: Record<string, any> = {
              tool_name: toolName,
              hook_event: entry.hook_event || 'PreToolUse',
            };

            if (entry.tool_input) {
              toolMetadata['tool_input'] = entry.tool_input;
            }

            const interaction = {
              interaction_type: 'tool_call',
              content: `Tool: ${toolName}`,
              timestamp: entry.timestamp,
              metadata: toolMetadata,
            };

            interactions.push(interaction);

            if (entry.tool_use_id) {
              toolCallMap.set(entry.tool_use_id, interaction);
            }
          }
        } catch (jsonError) {
          logger.warn(`Failed to parse line in sub-agent transcript ${agentId}:`, jsonError);
          continue;
        }
      }

      const totalTokens = inputTokens + outputTokens;

      logger.info(`Parsed sub-agent ${agentId}: ${interactions.length} interactions, ${messages.length} messages, ${totalTokens} tokens`);

      return {
        agentId,
        taskDescription,
        taskPrompt,
        interactionIndex,
        interactions,
        messages,
        startTime,
        endTime: endTime || null,
        totalTokens,
        inputTokens,
        outputTokens,
      };
    } catch (error) {
      logger.error(`Failed to parse sub-agent file ${filePath}:`, error);
      return null;
    }
  }

  async findLatestTranscriptFile(projectPath: string, sessionId?: string): Promise<string | null> {
    try {
      const fs = await import('fs/promises');
      const path = await import('path');

      // Claude Code replaces path separators AND underscores with hyphens
      const projectDirName = projectPath.replace(/[\\/]/g, '-').replace(/_/g, '-');
      const claudeProjectsDir = path.join(homedir(), '.claude', 'projects', projectDirName);

      logger.info(`Looking for transcript files in: ${claudeProjectsDir}`);
      if (sessionId) {
        logger.info(`Looking for specific session ID: ${sessionId}`);
      }

      try {
        const files = await fs.readdir(claudeProjectsDir);

        const jsonlFiles = files.filter((f) =>
          f.endsWith('.jsonl') && !f.startsWith('agent-')
        );

        logger.info(`Found ${jsonlFiles.length} JSONL files`);

        if (jsonlFiles.length === 0) {
          return null;
        }

        // If sessionId is provided, search for the specific transcript file
        if (sessionId) {
          for (const file of jsonlFiles) {
            const filePath = path.join(claudeProjectsDir, file);
            const fileSessionId = await this.quickExtractSessionId(filePath);

            if (fileSessionId === sessionId) {
              // Check if this file is a stub (< 10KB) - probably from /clear or resume
              const stats = await fs.stat(filePath);
              if (stats.size < 10000) {
                logger.warn(`Session ${sessionId} file is a stub (${stats.size} bytes). Falling back to latest by mtime.`);
                break; // Fall through to mtime selection
              }
              logger.info(`Found matching transcript file for session ${sessionId}: ${file}`);
              return filePath;
            }
          }

          // If no match found with session ID, log warning and fall back to mtime
          logger.warn(`No transcript file found for session ID: ${sessionId}. Falling back to latest.`);
        }

        // Fall back to timestamp/mtime-based selection
        const fileStats = await Promise.all(
          jsonlFiles.map(async (file) => {
            const filePath = path.join(claudeProjectsDir, file);
            const stats = await fs.stat(filePath);
            const sessionTimestamp = await this.quickExtractTimestamp(filePath);

            return {
              file,
              path: filePath,
              mtime: stats.mtime,
              sessionStartTime: sessionTimestamp
            };
          })
        );

        // Filter out invalid/empty transcript files (files without session data)
        // These are files that only contain summary/snapshot entries but no actual conversation
        const validFiles = fileStats.filter(f => f.sessionStartTime !== null);

        // If all files are invalid, fall back to all files sorted by mtime
        const filesToSort = validFiles.length > 0 ? validFiles : fileStats;

        // Sort by mtime (most recently modified = current active session)
        filesToSort.sort((a, b) => {
          return b.mtime.getTime() - a.mtime.getTime();
        });

        const latestFile = filesToSort[0];
        logger.info(`Latest file: ${latestFile.file}`);
        return latestFile.path;
      } catch (error) {
        console.error(`Failed to read Claude projects directory: ${claudeProjectsDir}`, error);
        return null;
      }
    } catch (error) {
      console.error('Failed to find latest transcript file:', error);
      return null;
    }
  }

  async listTranscriptFiles(projectPath: string): Promise<string[]> {
    try {
      const fs = await import('fs/promises');
      const path = await import('path');

      // Claude Code replaces path separators AND underscores with hyphens
      const projectDirName = projectPath.replace(/[\\/]/g, '-').replace(/_/g, '-');
      const claudeProjectsDir = path.join(homedir(), '.claude', 'projects', projectDirName);

      const files = await fs.readdir(claudeProjectsDir);

      return files
        .filter((f) => f.endsWith('.jsonl') && !f.startsWith('agent-'))
        .map((f) => path.join(claudeProjectsDir, f));
    } catch (error) {
      return [];
    }
  }
}
