/**
 * Storage uploader for session attachments (images, files).
 * Handles uploading base64-encoded attachments to Supabase Storage.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { decode } from 'base64-arraybuffer';

export interface AttachmentMetadata {
  interactionIndex: number;
  type: 'image' | 'file';
  storagePath: string;
  mediaType: string;
  filename: string;
  sizeBytes: number;
  uploadedAt: string;
  publicUrl?: string;
}

export class StorageUploader {
  private supabase: SupabaseClient;
  private bucketName = 'session-attachments';

  constructor(supabaseUrl: string, supabaseServiceKey: string) {
    this.supabase = createClient(supabaseUrl, supabaseServiceKey);
  }

  async uploadImage(
    userId: string,
    sessionId: string,
    interactionIndex: number,
    base64Data: string,
    mediaType: string = 'image/png'
  ): Promise<AttachmentMetadata | null> {
    try {
      const extension = this.getExtensionFromMediaType(mediaType);
      const timestamp = Date.now();
      const filename = `${interactionIndex}_${timestamp}.${extension}`;
      const storagePath = `${userId}/${sessionId}/${filename}`;

      const arrayBuffer = decode(base64Data);
      const sizeBytes = arrayBuffer.byteLength;

      const { data, error } = await this.supabase.storage
        .from(this.bucketName)
        .upload(storagePath, arrayBuffer, {
          contentType: mediaType,
          cacheControl: '3600',
          upsert: false,
        });

      if (error) {
        console.error(`[StorageUploader] Upload failed: ${error.message}`, error);
        return null;
      }

      return {
        interactionIndex,
        type: 'image',
        storagePath,
        mediaType,
        filename,
        sizeBytes,
        uploadedAt: new Date().toISOString(),
      };
    } catch (error) {
      console.error(`[StorageUploader] Exception during upload:`, error);
      return null;
    }
  }

  private getExtensionFromMediaType(mediaType: string): string {
    const mapping: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/svg+xml': 'svg',
      'application/pdf': 'pdf',
    };

    return mapping[mediaType] || 'bin';
  }

  extractImagesFromContent(messageContent: any[]): Array<{
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

  replaceImageWithReference(messageContent: any[], attachmentIndex: number): any[] {
    return messageContent.map((item) => {
      if (
        item.type === 'image' &&
        item.source?.type === 'base64'
      ) {
        return {
          type: 'image_ref',
          attachment_index: attachmentIndex,
        };
      }
      return item;
    });
  }
}
