import { inject, Injectable, signal } from '@angular/core';
import { api } from 'convex/_generated/api';
import { Id } from 'convex/_generated/dataModel';
import { ConvexService } from './convex.service';
import { WorkspaceService } from './workspace.service';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_DIMENSION = 400; // Max width/height for logos (400px for retina support)
const COMPRESSION_QUALITY = 0.85; // JPEG quality (0-1)

export interface UploadProgress {
  status: 'idle' | 'uploading' | 'saving' | 'complete' | 'error';
  progress: number; // 0-100
  error?: string;
}

@Injectable({
  providedIn: 'root',
})
export class LogoUploadService {
  private readonly convexService = inject(ConvexService);
  private readonly workspaceService = inject(WorkspaceService);

  private readonly _uploadProgress = signal<UploadProgress>({ status: 'idle', progress: 0 });
  readonly uploadProgress = this._uploadProgress.asReadonly();

  /**
   * Upload a logo file and return the resulting URL
   * Uses Convex's two-step upload pattern:
   * 1. Get a signed upload URL from Convex
   * 2. Upload the file directly to Convex storage
   * 3. Save the upload record and get the final URL
   */
  async uploadLogo(
    file: File,
    entityType: 'merchant' | 'bankAccount',
    entityId: Id<'merchant'> | Id<'bankAccount'>
  ): Promise<string> {
    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      throw new Error('No active workspace');
    }

    // Reset progress
    this._uploadProgress.set({ status: 'idle', progress: 0 });

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      this._uploadProgress.set({ status: 'error', progress: 0, error: 'File size exceeds maximum of 5MB' });
      throw new Error('File size exceeds maximum of 5MB');
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      this._uploadProgress.set({ status: 'error', progress: 0, error: 'Only image files are allowed' });
      throw new Error('Only image files are allowed');
    }

    try {
      // Step 1: Process image (resize and compress)
      this._uploadProgress.set({ status: 'uploading', progress: 10 });
      const processedBlob = await this.processImage(file);

      // Step 2: Get upload URL
      this._uploadProgress.set({ status: 'uploading', progress: 20 });

      const uploadUrl = await this.convexService.mutation<string>(api.storage.generateUploadUrl, {
        workspaceId: workspaceId as Id<'workspace'>,
      });

      // Step 3: Upload processed image to Convex storage
      this._uploadProgress.set({ status: 'uploading', progress: 40 });

      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'image/jpeg',
        },
        body: processedBlob,
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
      }

      const { storageId } = (await response.json()) as { storageId: Id<'_storage'> };

      // Step 4: Save upload record and get final URL
      this._uploadProgress.set({ status: 'saving', progress: 80 });

      const finalUrl = await this.convexService.mutation<string>(api.storage.saveUploadedLogo, {
        workspaceId: workspaceId as Id<'workspace'>,
        storageId,
        entityType,
        entityId,
        mimeType: 'image/jpeg',
        fileSize: processedBlob.size,
      });

      this._uploadProgress.set({ status: 'complete', progress: 100 });

      return finalUrl;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Upload failed';
      this._uploadProgress.set({ status: 'error', progress: 0, error: errorMessage });
      throw error;
    }
  }

  /**
   * Reset the upload progress state
   */
  resetProgress(): void {
    this._uploadProgress.set({ status: 'idle', progress: 0 });
  }

  /**
   * Check if a file is valid for upload (client-side validation)
   */
  validateFile(file: File): { valid: boolean; error?: string } {
    if (file.size > MAX_FILE_SIZE) {
      return { valid: false, error: 'File size exceeds maximum of 5MB' };
    }

    if (!file.type.startsWith('image/')) {
      return { valid: false, error: 'Only image files are allowed' };
    }

    return { valid: true };
  }

  /**
   * Process an image file: center-crop to square, resize, and compress as JPEG
   * Returns a new Blob with the processed image
   */
  private async processImage(file: File): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);

      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        try {
          const { width, height } = img;

          // Calculate center crop to square
          const size = Math.min(width, height);
          const cropX = (width - size) / 2;
          const cropY = (height - size) / 2;

          // Output size (square, max MAX_DIMENSION)
          const outputSize = Math.min(size, MAX_DIMENSION);

          // Create canvas for the square output
          const canvas = document.createElement('canvas');
          canvas.width = outputSize;
          canvas.height = outputSize;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Failed to get canvas context'));
            return;
          }

          // Draw center-cropped and resized image
          ctx.drawImage(img, cropX, cropY, size, size, 0, 0, outputSize, outputSize);

          // Convert to JPEG blob
          canvas.toBlob(
            (blob) => {
              if (blob) {
                resolve(blob);
              } else {
                reject(new Error('Failed to create image blob'));
              }
            },
            'image/jpeg',
            COMPRESSION_QUALITY
          );
        } catch (error: unknown) {
          reject(error instanceof Error ? error : new Error('Failed to process image'));
        }
      };

      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Failed to load image'));
      };

      img.src = objectUrl;
    });
  }
}
