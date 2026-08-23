import { createHash } from "node:crypto";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { getApps } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import {
  PropertyAssetConflictError,
  PropertyAssetIntegrityError,
  PropertyAssetTooLargeError,
  type PropertyAssetStorage,
  type StorePropertyAssetInput,
  type StoredPropertyAsset
} from "./property-asset-storage.js";

interface VerifiedStreamResult {
  byteSize: number;
  sha256: string;
}

export class AssetVerifier extends Transform {
  private readonly hash = createHash("sha256");
  private byteSize = 0;

  constructor(
    private readonly maxBytes: number,
    private readonly expectedSha256: string
  ) {
    super();
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null, data?: Buffer) => void
  ): void {
    this.byteSize += chunk.length;
    if (this.byteSize > this.maxBytes) {
      callback(new PropertyAssetTooLargeError(this.maxBytes));
      return;
    }
    this.hash.update(chunk);
    callback(null, chunk);
  }

  result(): VerifiedStreamResult {
    const sha256 = this.hash.digest("hex");
    if (sha256 !== this.expectedSha256) {
      throw new PropertyAssetIntegrityError("Uploaded content does not match its SHA-256 digest");
    }
    return { byteSize: this.byteSize, sha256 };
  }
}

async function verifyAndDiscard(
  stream: Readable,
  maxBytes: number,
  expectedSha256: string
): Promise<VerifiedStreamResult> {
  const verifier = new AssetVerifier(maxBytes, expectedSha256);
  verifier.resume();
  await pipeline(stream, verifier);
  return verifier.result();
}

function metadataString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export class FirebasePropertyAssetStorage implements PropertyAssetStorage {
  private readonly bucket;

  constructor(bucketName: string) {
    const app = getApps()[0];
    if (!app) {
      throw new Error("Firebase must be initialized before property storage");
    }
    this.bucket = getStorage(app).bucket(bucketName);
  }

  async store(input: StorePropertyAssetInput): Promise<StoredPropertyAsset> {
    const file = this.bucket.file(input.objectKey);
    const [exists] = await file.exists();

    if (exists) {
      const retry = await verifyAndDiscard(input.stream, input.maxBytes, input.expectedSha256);
      const [metadata] = await file.getMetadata();
      const storedSha256 = metadataString(metadata.metadata?.["wildleafSha256"]);
      const storedSize = Number(metadata.size);
      if (
        storedSha256 !== retry.sha256 ||
        metadata.contentType !== input.contentType ||
        !Number.isSafeInteger(storedSize) ||
        storedSize !== retry.byteSize
      ) {
        throw new PropertyAssetConflictError(
          "This idempotency key is already associated with different upload content"
        );
      }
      return {
        objectKey: input.objectKey,
        contentType: input.contentType,
        byteSize: retry.byteSize,
        sha256: retry.sha256,
        replayed: true
      };
    }

    const verifier = new AssetVerifier(input.maxBytes, input.expectedSha256);
    const destination = file.createWriteStream({
      resumable: false,
      validation: "crc32c",
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: {
        contentType: input.contentType,
        cacheControl: input.cacheControl,
        metadata: { wildleafSha256: input.expectedSha256 }
      }
    });

    try {
      await pipeline(input.stream, verifier, destination);
      const result = verifier.result();
      return {
        objectKey: input.objectKey,
        contentType: input.contentType,
        byteSize: result.byteSize,
        sha256: result.sha256,
        replayed: false
      };
    } catch (error) {
      if (
        error instanceof PropertyAssetTooLargeError ||
        error instanceof PropertyAssetIntegrityError
      ) {
        await file.delete({ ignoreNotFound: true }).catch(() => undefined);
        throw error;
      }
      throw error;
    }
  }

  async createReadUrl(objectKey: string, expiresAt: Date): Promise<string> {
    const [url] = await this.bucket.file(objectKey).getSignedUrl({
      action: "read",
      version: "v4",
      expires: expiresAt
    });
    return url;
  }
}
