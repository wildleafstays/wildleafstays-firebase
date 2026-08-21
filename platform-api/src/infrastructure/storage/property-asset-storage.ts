import type { Readable } from "node:stream";

export interface StorePropertyAssetInput {
  objectKey: string;
  contentType: string;
  expectedSha256: string;
  maxBytes: number;
  stream: Readable;
  cacheControl: string;
}

export interface StoredPropertyAsset {
  objectKey: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  replayed: boolean;
}

export interface PropertyAssetStorage {
  store(input: StorePropertyAssetInput): Promise<StoredPropertyAsset>;
  createReadUrl(objectKey: string, expiresAt: Date): Promise<string>;
}

export class PropertyAssetTooLargeError extends Error {
  constructor(public readonly maxBytes: number) {
    super(`Property asset exceeds ${maxBytes} bytes`);
    this.name = "PropertyAssetTooLargeError";
  }
}

export class PropertyAssetIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PropertyAssetIntegrityError";
  }
}

export class PropertyAssetConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PropertyAssetConflictError";
  }
}
