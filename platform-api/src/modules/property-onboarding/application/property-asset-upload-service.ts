import { createHash } from "node:crypto";
import path from "node:path";
import { Transform, type Readable } from "node:stream";
import type { Kysely } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import {
  PropertyAssetConflictError,
  PropertyAssetIntegrityError,
  PropertyAssetTooLargeError,
  type PropertyAssetStorage,
  type StoredPropertyAsset
} from "../../../infrastructure/storage/property-asset-storage.js";
import type { ActorContext } from "../../access/domain/actor-context.js";
import { ConflictError, ValidationError } from "../../../shared/errors/app-error.js";
import type { DocumentType } from "../domain/property-onboarding.js";
import { PropertyOnboardingService } from "./property-onboarding-service.js";

export const MAX_PROPERTY_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_PROPERTY_DOCUMENT_BYTES = 12 * 1024 * 1024;
export const ASSET_READ_URL_TTL_MS = 5 * 60 * 1000;

const IMAGE_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/avif", "avif"]
]);

class FileSignatureVerifier extends Transform {
  private prefix = Buffer.alloc(0);

  constructor(private readonly contentType: string) {
    super();
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null, data?: Buffer) => void
  ): void {
    if (this.prefix.length < 16) {
      this.prefix = Buffer.concat([this.prefix, chunk]).subarray(0, 16);
    }
    callback(null, chunk);
  }

  override _flush(callback: (error?: Error | null) => void): void {
    const valid =
      (this.contentType === "image/jpeg" &&
        this.prefix.length >= 3 &&
        this.prefix[0] === 0xff &&
        this.prefix[1] === 0xd8 &&
        this.prefix[2] === 0xff) ||
      (this.contentType === "image/png" &&
        this.prefix.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) ||
      (this.contentType === "image/webp" &&
        this.prefix.subarray(0, 4).toString("ascii") === "RIFF" &&
        this.prefix.subarray(8, 12).toString("ascii") === "WEBP") ||
      (this.contentType === "image/avif" &&
        this.prefix.subarray(4, 8).toString("ascii") === "ftyp" &&
        ["avif", "avis", "mif1"].includes(this.prefix.subarray(8, 12).toString("ascii"))) ||
      (this.contentType === "application/pdf" &&
        this.prefix.subarray(0, 5).toString("ascii") === "%PDF-");

    callback(
      valid
        ? null
        : new PropertyAssetIntegrityError("Uploaded bytes do not match the declared file type")
    );
  }
}

function verifyFileSignature(stream: Readable, contentType: string): Readable {
  return stream.pipe(new FileSignatureVerifier(contentType));
}

export interface ManagedImageUploadInput {
  actor: ActorContext;
  organizationId: string;
  propertyId: string;
  idempotencyKey: string;
  contentType: string;
  contentSha256: string;
  stream: Readable;
}

export interface ManagedRoomCategoryImageUploadInput extends ManagedImageUploadInput {
  roomCategoryId: string;
}

export interface ManagedDocumentUploadInput extends ManagedImageUploadInput {
  documentType: DocumentType;
  originalFilename: string;
}

function assertSha256(value: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new ValidationError("X-Content-SHA256 must be a lowercase hexadecimal SHA-256 digest");
  }
  return value;
}

function stableObjectId(input: ManagedImageUploadInput, assetKind: string): string {
  return createHash("sha256")
    .update(`${assetKind}:${input.actor.userId}:${input.propertyId}:${input.idempotencyKey}`)
    .digest("hex");
}

function safeOriginalFilename(value: string): string {
  const normalized = path
    .basename(value)
    .normalize("NFKC")
    .split("")
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint > 31 && codePoint !== 127;
    })
    .join("")
    .trim();
  if (!normalized || normalized.length > 255) {
    throw new ValidationError("Uploaded document filename is invalid");
  }
  return normalized;
}

async function translateStorageErrors<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof PropertyAssetTooLargeError) {
      throw new ValidationError("Uploaded file is too large", { maxBytes: error.maxBytes });
    }
    if (error instanceof PropertyAssetIntegrityError) {
      throw new ValidationError(error.message);
    }
    if (error instanceof PropertyAssetConflictError) {
      throw new ConflictError(error.message);
    }
    throw error;
  }
}

export class PropertyAssetUploadService {
  constructor(
    private readonly storage: PropertyAssetStorage,
    private readonly onboarding = new PropertyOnboardingService()
  ) {}

  async assertUploadAllowed(
    db: Kysely<Database>,
    actor: ActorContext,
    organizationId: string,
    propertyId: string
  ): Promise<void> {
    await this.onboarding.assertOwnerContentEditable(db, actor, organizationId, propertyId);
  }

  async storeImage(input: ManagedImageUploadInput): Promise<StoredPropertyAsset> {
    const extension = IMAGE_TYPES.get(input.contentType);
    if (!extension) {
      throw new ValidationError("Property images must be JPEG, PNG, WebP or AVIF");
    }
    const sha256 = assertSha256(input.contentSha256);
    const objectKey = `properties/${input.organizationId}/${input.propertyId}/media/${stableObjectId(input, "image")}.${extension}`;
    return translateStorageErrors(() =>
      this.storage.store({
        objectKey,
        contentType: input.contentType,
        expectedSha256: sha256,
        maxBytes: MAX_PROPERTY_IMAGE_BYTES,
        stream: verifyFileSignature(input.stream, input.contentType),
        cacheControl: "public, max-age=31536000, immutable"
      })
    );
  }

  async storeRoomCategoryImage(
    input: ManagedRoomCategoryImageUploadInput
  ): Promise<StoredPropertyAsset> {
    const extension = IMAGE_TYPES.get(input.contentType);
    if (!extension) {
      throw new ValidationError("Room category images must be JPEG, PNG, WebP or AVIF");
    }

    const sha256 = assertSha256(input.contentSha256);
    const objectKey = `properties/${input.organizationId}/${input.propertyId}/room-categories/${input.roomCategoryId}/media/${stableObjectId(
      input,
      `room-category-image:${input.roomCategoryId}`
    )}.${extension}`;

    return translateStorageErrors(() =>
      this.storage.store({
        objectKey,
        contentType: input.contentType,
        expectedSha256: sha256,
        maxBytes: MAX_PROPERTY_IMAGE_BYTES,
        stream: verifyFileSignature(input.stream, input.contentType),
        cacheControl: "public, max-age=31536000, immutable"
      })
    );
  }

  async storeDocument(input: ManagedDocumentUploadInput): Promise<{
    asset: StoredPropertyAsset;
    originalFilename: string;
  }> {
    if (input.contentType !== "application/pdf") {
      throw new ValidationError("Compliance documents must be PDF files");
    }
    const sha256 = assertSha256(input.contentSha256);
    const objectKey = `private/property-documents/${input.organizationId}/${input.propertyId}/${stableObjectId(input, "document")}.pdf`;
    const asset = await translateStorageErrors(() =>
      this.storage.store({
        objectKey,
        contentType: input.contentType,
        expectedSha256: sha256,
        maxBytes: MAX_PROPERTY_DOCUMENT_BYTES,
        stream: verifyFileSignature(input.stream, input.contentType),
        cacheControl: "private, no-store"
      })
    );
    return { asset, originalFilename: safeOriginalFilename(input.originalFilename) };
  }

  async createPlatformDocumentReadUrl(
    db: Kysely<Database>,
    actor: ActorContext,
    propertyId: string,
    documentId: string
  ): Promise<{ url: string; expiresAt: string }> {
    const storageKey = await this.onboarding.getPlatformDocumentStorageKey(
      db,
      actor,
      propertyId,
      documentId
    );
    const expiresAt = new Date(Date.now() + ASSET_READ_URL_TTL_MS);
    const url = await this.storage.createReadUrl(storageKey, expiresAt);
    return { url, expiresAt: expiresAt.toISOString() };
  }
}
