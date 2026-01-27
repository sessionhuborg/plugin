/**
 * gRPC client for SessionHub backend
 *
 * High-performance gRPC client using Protocol Buffers for 6-10x faster processing.
 */

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { SessionApiData, UserInfo, ApiInteractionData } from './models.js';
import { logger } from './logger.js';
import { encryptSessionFields, isValidPublicKey } from './encryption.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class GrpcAPIClient {
  private client: any;
  private apiKey: string;
  private backendUrl: string;

  constructor(apiKey: string, backendUrl: string = 'localhost:50051', useTls?: boolean) {
    this.apiKey = apiKey;
    // Add default port if not specified (443 for remote, 50051 for localhost)
    const isLocalhost = backendUrl.startsWith('localhost') || backendUrl.startsWith('127.0.0.1');
    if (!backendUrl.includes(':')) {
      this.backendUrl = isLocalhost ? `${backendUrl}:50051` : `${backendUrl}:443`;
    } else {
      this.backendUrl = backendUrl;
    }

    // Load protobuf definition - bundled with plugin
    // From dist/ folder: .. gets to sessionhub-plugin/proto/
    const PROTO_PATH = join(__dirname, '..', 'proto/sessionhub.proto');

    const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });

    const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as any;
    const sessionhub = protoDescriptor.sessionhub;

    // Auto-detect TLS: use secure for non-localhost, insecure for localhost
    const isLocalhostForTls = this.backendUrl.startsWith('localhost') || this.backendUrl.startsWith('127.0.0.1');
    const shouldUseTls = useTls ?? !isLocalhostForTls;

    const credentials = shouldUseTls
      ? grpc.credentials.createSsl()
      : grpc.credentials.createInsecure();

    this.client = new sessionhub.SessionHubService(
      this.backendUrl,
      credentials
    );

    logger.info(`gRPC client connected to ${this.backendUrl} (TLS: ${shouldUseTls})`);
  }

  private getMetadata(): grpc.Metadata {
    const metadata = new grpc.Metadata();
    metadata.add('authorization', `Bearer ${this.apiKey}`);
    return metadata;
  }

  /**
   * Create a deadline for gRPC calls to prevent indefinite hangs
   * @param timeoutSeconds Timeout in seconds (default: 30)
   */
  private getDeadline(timeoutSeconds: number = 30): Date {
    const deadline = new Date();
    deadline.setSeconds(deadline.getSeconds() + timeoutSeconds);
    return deadline;
  }

  /**
   * Check if an error is a "not found" type error that should resolve to null
   */
  private isNotFoundError(error: grpc.ServiceError): boolean {
    return error.code === grpc.status.NOT_FOUND;
  }

  /**
   * Get a user-friendly error message based on gRPC error code
   */
  private getErrorMessage(error: grpc.ServiceError, operation: string): string {
    switch (error.code) {
      case grpc.status.UNAVAILABLE:
        return `Cannot reach SessionHub server. Check your internet connection and try again.`;
      case grpc.status.DEADLINE_EXCEEDED:
        return `Request timed out. The server may be busy - please try again.`;
      case grpc.status.UNAUTHENTICATED:
        return `Invalid API key. Run /sessionhub:setup with a valid key from https://sessionhub.dev/settings`;
      case grpc.status.PERMISSION_DENIED:
        return `Access denied. Your API key may not have permission for this operation.`;
      case grpc.status.RESOURCE_EXHAUSTED:
        return `Rate limit exceeded or quota exhausted. Please try again later.`;
      case grpc.status.INTERNAL:
        return `Server error. Please try again or contact support if the issue persists.`;
      default:
        return `${operation} failed: ${error.message}`;
    }
  }

  private transformAttachmentMetadata(attachments: any[]): any[] {
    return attachments.map(att => ({
      type: att.type || 'image',
      storage_path: att.storagePath || att.storage_path || '',
      public_url: att.publicUrl || att.public_url || '',
      media_type: att.mediaType || att.media_type || '',
      filename: att.filename || '',
      size_bytes: att.sizeBytes || att.size_bytes || 0,
      interaction_index: att.interactionIndex ?? att.interaction_index ?? 0,
      uploaded_at: att.uploadedAt || att.uploaded_at || new Date().toISOString(),
    }));
  }

  async validateApiKey(): Promise<UserInfo | null> {
    return new Promise((resolve, reject) => {
      this.client.validateApiKey(
        { api_key: this.apiKey },
        { deadline: this.getDeadline() },
        (error: grpc.ServiceError | null, response: any) => {
          if (error) {
            // NOT_FOUND or UNAUTHENTICATED means invalid API key - expected, return null
            if (this.isNotFoundError(error) || error.code === grpc.status.UNAUTHENTICATED) {
              resolve(null);
              return;
            }
            // Other errors (timeout, unavailable) should reject with friendly message
            reject(new Error(this.getErrorMessage(error, 'API key validation')));
            return;
          }

          resolve({
            userId: response.user_id,
            email: response.email,
            subscriptionTier: response.subscription_tier,
          });
        }
      );
    });
  }

  async getProjects(): Promise<any[]> {
    return new Promise((resolve, reject) => {
      this.client.getProjects(
        {},
        this.getMetadata(),
        { deadline: this.getDeadline() },
        (error: grpc.ServiceError | null, response: any) => {
          if (error) {
            // Return empty array for not found, reject for other errors
            if (this.isNotFoundError(error)) {
              resolve([]);
              return;
            }
            reject(new Error(`Failed to get projects: ${error.message}`));
            return;
          }

          const projects = response.projects.map((p: any) => ({
            id: p.id,
            name: p.name,
            display_name: p.display_name,
            description: p.description,
            user_id: p.user_id,
            created_at: p.created_at,
            updated_at: p.updated_at,
            last_activity_at: p.last_activity_at,
            archived: p.archived,
            metadata: p.metadata,
            git_remote: p.git_remote,
            github_repo_name: p.github_repo_name,
            github_repo_owner: p.github_repo_owner,
            github_repo_id: p.github_repo_id,
            github_default_branch: p.github_default_branch,
            github_connected_at: p.github_connected_at,
          }));

          resolve(projects);
        }
      );
    });
  }

  async createProject(projectData: {
    name: string;
    display_name: string;
    description?: string;
    git_remote?: string;
    metadata?: Record<string, any>;
  }): Promise<any | null> {
    return new Promise((resolve, reject) => {
      this.client.createProject(
        projectData,
        this.getMetadata(),
        { deadline: this.getDeadline() },
        (error: grpc.ServiceError | null, response: any) => {
          if (error) {
            reject(new Error(`Failed to create project: ${error.message}`));
            return;
          }

          resolve({
            id: response.id,
            name: response.name,
            display_name: response.display_name,
            ...response,
          });
        }
      );
    });
  }

  private determineSessionType(sessionName?: string, gitBranch?: string): string {
    const text = `${sessionName || ''} ${gitBranch || ''}`.toLowerCase();

    if (text.includes('bug') || text.includes('fix') || text.includes('hotfix')) {
      return 'bugfix';
    }
    if (text.includes('refactor')) {
      return 'refactor';
    }
    if (text.includes('explore') || text.includes('experiment')) {
      return 'exploration';
    }
    if (text.includes('debug')) {
      return 'debugging';
    }
    if (text.includes('feature')) {
      return 'feature';
    }

    return 'feature';
  }

  async createSession(sessionData: SessionApiData): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const serializedMetadata: Record<string, string> = {};
      if (sessionData.metadata) {
        for (const [key, value] of Object.entries(sessionData.metadata)) {
          if (typeof value === 'string') {
            serializedMetadata[key] = value;
          } else if (typeof value === 'number' || typeof value === 'boolean') {
            serializedMetadata[key] = String(value);
          } else if (value === null || value === undefined) {
            serializedMetadata[key] = String(value);
          } else {
            serializedMetadata[key] = JSON.stringify(value);
          }
        }
      }

      const transformedTodoSnapshots = sessionData.todo_snapshots && sessionData.todo_snapshots.length > 0
        ? sessionData.todo_snapshots
            .filter(snapshot => snapshot.timestamp && Array.isArray(snapshot.todos) && snapshot.todos.length > 0)
            .map(snapshot => ({
              timestamp: snapshot.timestamp,
              todos: snapshot.todos.map(todo => ({
                content: todo.content,
                status: todo.status,
                active_form: todo.activeForm
              }))
            }))
        : [];

      const sessionType = this.determineSessionType(sessionData.name, sessionData.git_branch);

      const subSessionsJson = sessionData.sub_sessions && sessionData.sub_sessions.length > 0
        ? JSON.stringify(sessionData.sub_sessions)
        : undefined;

      const request = {
        project_name: sessionData.project_name,
        project_path: sessionData.project_path,
        start_time: sessionData.start_time,
        end_time: sessionData.end_time,
        name: sessionData.name,
        tool_name: sessionData.tool_name,
        git_branch: sessionData.git_branch,
        type: sessionType,
        input_tokens: sessionData.input_tokens || 0,
        output_tokens: sessionData.output_tokens || 0,
        cache_create_tokens: sessionData.cache_create_tokens || 0,
        cache_read_tokens: sessionData.cache_read_tokens || 0,
        todo_snapshots: transformedTodoSnapshots,
        plans: sessionData.plans && sessionData.plans.length > 0
          ? sessionData.plans
          : [],
        attachment_urls: sessionData.attachment_urls && sessionData.attachment_urls.length > 0
          ? this.transformAttachmentMetadata(sessionData.attachment_urls)
          : [],
        sub_sessions_json: subSessionsJson,
        interactions: sessionData.interactions || [],
        metadata: serializedMetadata,
      };

      this.client.createSession(
        request,
        this.getMetadata(),
        { deadline: this.getDeadline(60) }, // Longer timeout for session creation
        (error: grpc.ServiceError | null, response: any) => {
          if (error) {
            reject(new Error(`Failed to create session: ${error.message}`));
            return;
          }

          logger.info(`Session created: ${response.session_id}`);
          resolve(response.session_id);
        }
      );
    });
  }

  async upsertSession(sessionData: SessionApiData): Promise<{
    sessionId: string | null;
    wasUpdated: boolean;
    newInteractionsCount: number;
    analysisTriggered: boolean;
    observationsTriggered: boolean;
  }> {
    // Get encryption key (personal mode only for standalone plugin)
    let publicKey: string | null = null;
    let keyVersion = 0;
    let encryptedFields: any = null;

    try {
      // Get user's public key for encryption
      const keyData = await this.getUserPublicKey();
      if (keyData?.publicKey && await isValidPublicKey(keyData.publicKey)) {
        publicKey = keyData.publicKey;
        keyVersion = keyData.keyVersion;
        logger.info('Using personal encryption key for session data');
      }

      // Encrypt sensitive fields if we have a valid key
      if (publicKey) {
        encryptedFields = await encryptSessionFields({
          interactions: sessionData.interactions,
          todoSnapshots: sessionData.todo_snapshots,
          plans: sessionData.plans,
          subSessions: sessionData.sub_sessions,
          attachmentUrls: sessionData.attachment_urls,
        }, publicKey);
        logger.info('Session data encrypted successfully');
      }
    } catch (error) {
      // Encryption failure shouldn't block session capture - log and continue with plaintext
      logger.warn('Failed to encrypt session data, sending plaintext:', error);
    }

    return new Promise((resolve, reject) => {
      const serializedMetadata: Record<string, string> = {};
      if (sessionData.metadata) {
        for (const [key, value] of Object.entries(sessionData.metadata)) {
          if (typeof value === 'string') {
            serializedMetadata[key] = value;
          } else if (typeof value === 'number' || typeof value === 'boolean') {
            serializedMetadata[key] = String(value);
          } else if (value === null || value === undefined) {
            serializedMetadata[key] = String(value);
          } else {
            serializedMetadata[key] = JSON.stringify(value);
          }
        }
      }

      const transformedTodoSnapshots = sessionData.todo_snapshots && sessionData.todo_snapshots.length > 0
        ? sessionData.todo_snapshots
            .filter(snapshot => snapshot.timestamp && Array.isArray(snapshot.todos) && snapshot.todos.length > 0)
            .map(snapshot => ({
              timestamp: snapshot.timestamp,
              todos: snapshot.todos.map(todo => ({
                content: todo.content,
                status: todo.status,
                active_form: todo.activeForm
              }))
            }))
        : [];

      const sessionType = this.determineSessionType(sessionData.name, sessionData.git_branch);

      const subSessionsJson = sessionData.sub_sessions && sessionData.sub_sessions.length > 0
        ? JSON.stringify(sessionData.sub_sessions)
        : undefined;

      // Build request - if encrypted, send encrypted fields and mark plaintext fields as empty
      const isEncrypted = encryptedFields !== null;

      const request: any = {
        project_name: sessionData.project_name,
        project_path: sessionData.project_path,
        start_time: sessionData.start_time,
        end_time: sessionData.end_time,
        name: sessionData.name,
        tool_name: sessionData.tool_name,
        git_branch: sessionData.git_branch,
        type: sessionType,
        input_tokens: sessionData.input_tokens || 0,
        output_tokens: sessionData.output_tokens || 0,
        cache_create_tokens: sessionData.cache_create_tokens || 0,
        cache_read_tokens: sessionData.cache_read_tokens || 0,
        metadata: serializedMetadata,
      };

      if (isEncrypted) {
        // Send encrypted data
        request.encryption_status = 'encrypted';
        request.encryption_version = keyVersion;
        request.encrypted_interactions = encryptedFields.encryptedInteractions;
        request.encrypted_todo_snapshots = encryptedFields.encryptedTodoSnapshots;
        request.encrypted_plans = encryptedFields.encryptedPlans;
        request.encrypted_sub_sessions = encryptedFields.encryptedSubSessions;
        request.encrypted_attachment_urls = encryptedFields.encryptedAttachmentUrls;
        // Empty arrays for plaintext fields (backend stores encrypted versions)
        request.todo_snapshots = [];
        request.plans = [];
        request.attachment_urls = [];
        request.interactions = [];
        request.sub_sessions_json = undefined;
      } else {
        // Send plaintext data
        request.encryption_status = 'plaintext';
        request.encryption_version = 0;
        request.todo_snapshots = transformedTodoSnapshots;
        request.plans = sessionData.plans && sessionData.plans.length > 0 ? sessionData.plans : [];
        request.attachment_urls = sessionData.attachment_urls && sessionData.attachment_urls.length > 0
          ? this.transformAttachmentMetadata(sessionData.attachment_urls)
          : [];
        request.sub_sessions_json = subSessionsJson;
        request.interactions = (sessionData.interactions || []).map((int: any) => {
          const serializedInteractionMetadata: Record<string, string> = {};
          if (int.metadata) {
            for (const [key, value] of Object.entries(int.metadata)) {
              if (typeof value === 'string') {
                serializedInteractionMetadata[key] = value;
              } else if (typeof value === 'number' || typeof value === 'boolean') {
                serializedInteractionMetadata[key] = String(value);
              } else if (value === null || value === undefined) {
                serializedInteractionMetadata[key] = String(value);
              } else {
                serializedInteractionMetadata[key] = JSON.stringify(value);
              }
            }
          }
          return {
            timestamp: int.timestamp,
            interaction_type: int.interaction_type,
            content: int.content,
            tool_name: int.tool_name,
            metadata: serializedInteractionMetadata,
            input_tokens: int.input_tokens || 0,
            output_tokens: int.output_tokens || 0,
          };
        });
      }

      this.client.upsertSession(
        request,
        this.getMetadata(),
        { deadline: this.getDeadline(60) }, // Longer timeout for session upsert
        (error: grpc.ServiceError | null, response: any) => {
          if (error) {
            reject(new Error(`Failed to upsert session: ${error.message}`));
            return;
          }

          const action = response.was_updated ? 'updated' : 'created';
          const encryptionNote = isEncrypted ? ' (encrypted)' : '';
          logger.info(`Session ${action}: ${response.session_id} (${response.new_interactions_count} interactions)${encryptionNote}`);
          if (response.analysis_triggered) {
            logger.info('Analysis triggered based on user preferences');
          }
          if (response.observations_triggered) {
            logger.info('Observations extraction triggered based on user preferences');
          }
          resolve({
            sessionId: response.session_id,
            wasUpdated: response.was_updated,
            newInteractionsCount: response.new_interactions_count || 0,
            analysisTriggered: response.analysis_triggered || false,
            observationsTriggered: response.observations_triggered || false,
          });
        }
      );
    });
  }

  async updateSessionEndTime(sessionId: string, endTime: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      this.client.updateSession(
        {
          session_id: sessionId,
          end_time: endTime,
        },
        this.getMetadata(),
        { deadline: this.getDeadline() },
        (error: grpc.ServiceError | null, response: any) => {
          if (error) {
            reject(new Error(`Failed to update session: ${error.message}`));
            return;
          }

          logger.info(`Session end time updated: ${sessionId}`);
          resolve(true);
        }
      );
    });
  }

  async addInteractionsBatch(
    sessionId: string,
    interactions: ApiInteractionData[],
    chunkSize: number = 500
  ): Promise<{ success: boolean; processed: number; failed: number }> {
    let totalProcessed = 0;
    let totalFailed = 0;

    for (let i = 0; i < interactions.length; i += chunkSize) {
      const chunk = interactions.slice(i, i + chunkSize);

      const result = await new Promise<{ processed: number; failed: number }>((resolve, reject) => {
        this.client.addInteractionsBatch(
          {
            session_id: sessionId,
            interactions: chunk.map((int) => {
              const serializedMetadata: Record<string, string> = {};
              if (int.metadata) {
                for (const [key, value] of Object.entries(int.metadata)) {
                  if (typeof value === 'string') {
                    serializedMetadata[key] = value;
                  } else if (typeof value === 'number' || typeof value === 'boolean') {
                    serializedMetadata[key] = String(value);
                  } else if (value === null || value === undefined) {
                    serializedMetadata[key] = String(value);
                  } else {
                    serializedMetadata[key] = JSON.stringify(value);
                  }
                }
              }

              return {
                timestamp: int.timestamp,
                interaction_type: int.interaction_type,
                content: int.content,
                tool_name: int.tool_name,
                metadata: serializedMetadata,
                input_tokens: int.input_tokens || 0,
                output_tokens: int.output_tokens || 0,
              };
            }),
          },
          this.getMetadata(),
          { deadline: this.getDeadline(60) }, // Longer timeout for batch operations
          (error: grpc.ServiceError | null, response: any) => {
            if (error) {
              logger.error(`Batch ${Math.floor(i / chunkSize) + 1} failed: ${error.message}`);
              // Don't reject, just return failed count to allow other batches to continue
              resolve({ processed: 0, failed: chunk.length });
              return;
            }

            logger.info(`Batch ${Math.floor(i / chunkSize) + 1}: ${response.processed} processed`);
            resolve({
              processed: response.processed,
              failed: response.failed,
            });
          }
        );
      });

      totalProcessed += result.processed;
      totalFailed += result.failed;
    }

    return {
      success: totalFailed === 0,
      processed: totalProcessed,
      failed: totalFailed,
    };
  }

  async streamInteractions(
    sessionId: string,
    interactions: ApiInteractionData[]
  ): Promise<{ success: boolean; processed: number; failed: number }> {
    return new Promise((resolve, reject) => {
      const call = this.client.streamInteractions(
        this.getMetadata(),
        (error: grpc.ServiceError | null, response: any) => {
          if (error) {
            logger.debug(`Stream failed: ${error.message}`);
            reject(error);
            return;
          }

          logger.info(`Stream complete: ${response.processed} processed`);
          resolve({
            success: response.success,
            processed: response.processed,
            failed: response.failed,
          });
        }
      );

      for (const interaction of interactions) {
        const serializedMetadata: Record<string, string> = {};
        if (interaction.metadata) {
          for (const [key, value] of Object.entries(interaction.metadata)) {
            if (typeof value === 'string') {
              serializedMetadata[key] = value;
            } else if (typeof value === 'number' || typeof value === 'boolean') {
              serializedMetadata[key] = String(value);
            } else if (value === null || value === undefined) {
              serializedMetadata[key] = String(value);
            } else {
              serializedMetadata[key] = JSON.stringify(value);
            }
          }
        }

        call.write({
          session_id: sessionId,
          interaction: {
            timestamp: interaction.timestamp,
            interaction_type: interaction.interaction_type,
            content: interaction.content,
            tool_name: interaction.tool_name,
            metadata: serializedMetadata,
            input_tokens: interaction.input_tokens || 0,
            output_tokens: interaction.output_tokens || 0,
          },
        });
      }

      call.end();
    });
  }

  async close(): Promise<void> {
    this.client.close();
  }

  /**
   * Get user preferences from the backend
   */
  async getUserPreferences(): Promise<{
    autoAnalysis: boolean;
    autoObservations: boolean;
    contextInjection: boolean;
    contextInjectionLimit: number;
    contextInjectionMaxTokens: number;
    contextInjectionFullDetailsCount: number;
    autoSaveSession: boolean;
  } | null> {
    return new Promise((resolve, reject) => {
      this.client.getUserPreferences(
        {},
        this.getMetadata(),
        { deadline: this.getDeadline() },
        (error: grpc.ServiceError | null, response: any) => {
          if (error) {
            // NOT_FOUND is acceptable - return null
            if (this.isNotFoundError(error)) {
              resolve(null);
              return;
            }
            reject(new Error(`Failed to get user preferences: ${error.message}`));
            return;
          }

          resolve({
            autoAnalysis: response.auto_analysis,
            autoObservations: response.auto_observations,
            contextInjection: response.context_injection,
            contextInjectionLimit: response.context_injection_limit || 50,
            contextInjectionMaxTokens: response.context_injection_max_tokens || 2500,
            contextInjectionFullDetailsCount: response.context_injection_full_details_count || 5,
            autoSaveSession: response.auto_save_session ?? true, // Default to enabled
          });
        }
      );
    });
  }

  /**
   * Upload an attachment to storage via the backend
   */
  async uploadAttachment(
    sessionId: string,
    interactionIndex: number,
    base64Data: string,
    mediaType: string,
    filename?: string
  ): Promise<{
    success: boolean;
    storagePath?: string;
    publicUrl?: string;
    error?: string;
  }> {
    return new Promise((resolve, reject) => {
      this.client.uploadAttachment(
        {
          session_id: sessionId,
          interaction_index: interactionIndex,
          base64_data: base64Data,
          media_type: mediaType,
          filename: filename,
        },
        this.getMetadata(),
        { deadline: this.getDeadline(60) }, // Longer timeout for file uploads
        (error: grpc.ServiceError | null, response: any) => {
          if (error) {
            // For upload failures, resolve with error info instead of rejecting
            // This allows callers to handle failures gracefully
            resolve({ success: false, error: error.message });
            return;
          }

          if (!response.success) {
            resolve({ success: false, error: response.error });
            return;
          }

          resolve({
            success: true,
            storagePath: response.storage_path,
            publicUrl: response.public_url,
          });
        }
      );
    });
  }

  /**
   * Get project observations for context injection
   */
  async getProjectObservations(projectId: string, limit?: number): Promise<{
    observations: Array<{
      id: string;
      sessionId: string;
      projectId: string;
      type: string;
      title: string;
      subtitle?: string;
      narrative: string;
      facts: string[];
      concepts: string[];
      files: string[];
      toolName?: string;
      createdAt: string;
    }>;
    totalCount: number;
  } | null> {
    return new Promise((resolve, reject) => {
      this.client.getProjectObservations(
        {
          project_id: projectId,
          limit: limit,
        },
        this.getMetadata(),
        { deadline: this.getDeadline() },
        (error: grpc.ServiceError | null, response: any) => {
          if (error) {
            // NOT_FOUND is acceptable - return null (no observations yet)
            if (this.isNotFoundError(error)) {
              resolve(null);
              return;
            }
            reject(new Error(`Failed to get project observations: ${error.message}`));
            return;
          }

          const observations = (response.observations || []).map((obs: any) => ({
            id: obs.id,
            sessionId: obs.session_id,
            projectId: obs.project_id,
            type: obs.type,
            title: obs.title,
            subtitle: obs.subtitle,
            narrative: obs.narrative,
            facts: obs.facts || [],
            concepts: obs.concepts || [],
            files: obs.files || [],
            toolName: obs.tool_name,
            createdAt: obs.created_at,
          }));

          resolve({
            observations,
            totalCount: response.total_count || observations.length,
          });
        }
      );
    });
  }

  /**
   * Get the authenticated user's public key for encryption
   * Used for personal (non-team) session encryption
   */
  async getUserPublicKey(): Promise<{
    publicKey: string;
    keyVersion: number;
  } | null> {
    return new Promise((resolve, reject) => {
      this.client.getUserPublicKey(
        {},
        this.getMetadata(),
        { deadline: this.getDeadline() },
        (error: grpc.ServiceError | null, response: any) => {
          if (error) {
            // NOT_FOUND means user has no key configured
            if (this.isNotFoundError(error)) {
              resolve(null);
              return;
            }
            reject(new Error(this.getErrorMessage(error, 'Get user public key')));
            return;
          }

          resolve({
            publicKey: response.public_key,
            keyVersion: response.key_version || 1,
          });
        }
      );
    });
  }

  /**
   * Get session quota information for the current user
   * Returns current session count, limit, and remaining capacity
   */
  async getSessionQuota(): Promise<{
    currentCount: number;
    limit: number;
    remaining: number;
    subscriptionTier: string;
  } | null> {
    return new Promise((resolve, reject) => {
      this.client.getSessionQuota(
        {},
        this.getMetadata(),
        { deadline: this.getDeadline() },
        (error: grpc.ServiceError | null, response: any) => {
          if (error) {
            // NOT_FOUND means no quota info - shouldn't happen but handle gracefully
            if (this.isNotFoundError(error)) {
              resolve(null);
              return;
            }
            reject(new Error(`Failed to get session quota: ${error.message}`));
            return;
          }

          resolve({
            currentCount: response.current_count || 0,
            limit: response.limit || 0,
            remaining: response.remaining || 0,
            subscriptionTier: response.subscription_tier || 'free',
          });
        }
      );
    });
  }
}

// ============================================================================
// Session Limit Error Handling Utilities
// ============================================================================

/**
 * Parsed session limit error information
 */
export interface SessionLimitError {
  type: 'session_limit_exceeded';
  currentCount: number;
  limit: number;
  upgradeUrl: string;
}

/**
 * Parse a session limit exceeded error from the backend
 * Returns null if the error is not a session limit error
 */
export function parseSessionLimitError(error: Error): SessionLimitError | null {
  const message = error.message || '';
  const match = message.match(/session_limit_exceeded:current=(\d+):limit=(\d+):upgrade_url=(.+)/);
  if (match) {
    return {
      type: 'session_limit_exceeded',
      currentCount: parseInt(match[1], 10),
      limit: parseInt(match[2], 10),
      upgradeUrl: match[3],
    };
  }
  return null;
}

/**
 * Check if an error is a gRPC RESOURCE_EXHAUSTED error (code 8)
 */
export function isResourceExhaustedError(error: any): boolean {
  return error?.code === 8; // grpc.status.RESOURCE_EXHAUSTED = 8
}

// ============================================================================
// Onboarding Error Handling Utilities
// ============================================================================

/**
 * Parsed onboarding error information
 */
export interface OnboardingError {
  type: 'onboarding_required';
  message: string;
}

/**
 * Parse an onboarding error from the backend
 * Returns null if the error is not an onboarding error
 */
export function parseOnboardingError(error: Error): OnboardingError | null {
  const message = error.message || '';
  if (message.includes('no team found') || message.includes('complete onboarding')) {
    return {
      type: 'onboarding_required',
      message: 'Please complete onboarding at https://sessionhub.dev to create or join a team',
    };
  }
  return null;
}
