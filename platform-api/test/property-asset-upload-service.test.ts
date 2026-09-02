import { createHash } from "node:crypto";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { describe, expect, it } from "vitest";
import type {
  PropertyAssetStorage,
  StorePropertyAssetInput,
  StoredPropertyAsset
} from "../src/infrastructure/storage/property-asset-storage.js";
import {
  PropertyAssetIntegrityError,
  PropertyAssetTooLargeError
} from "../src/infrastructure/storage/property-asset-storage.js";
import { AssetVerifier } from "../src/infrastructure/storage/firebase-property-asset-storage.js";
import {
  MAX_PROPERTY_DOCUMENT_BYTES,
  MAX_PROPERTY_IMAGE_BYTES,
  PropertyAssetUploadService
} from "../src/modules/property-onboarding/application/property-asset-upload-service.js";
import type { ActorContext } from "../src/modules/access/domain/actor-context.js";

const actor: ActorContext = {
  userId: "2d5cf05b-df00-4111-a949-a9ace7a8fb95",
  email: "owner@example.invalid",
  platformRoles: [],
  organizationMemberships: [],
  propertyGrants: []
};

class RecordingStorage implements PropertyAssetStorage {
  input: Omit<StorePropertyAssetInput, "stream"> | null = null;
  bytes: Buffer | null = null;

  async store(input: StorePropertyAssetInput): Promise<StoredPropertyAsset> {
    this.input = { ...input, stream: undefined } as unknown as Omit<
      StorePropertyAssetInput,
      "stream"
    >;
    const chunks: Buffer[] = [];
    for await (const chunk of input.stream) chunks.push(Buffer.from(chunk));
    this.bytes = Buffer.concat(chunks);
    return {
      objectKey: input.objectKey,
      contentType: input.contentType,
      byteSize: this.bytes.length,
      sha256: input.expectedSha256,
      replayed: false
    };
  }

  async createReadUrl(objectKey: string, expiresAt: Date): Promise<string> {
    return `https://storage.example.invalid/${encodeURIComponent(objectKey)}?expires=${expiresAt.getTime()}`;
  }
}

function digest(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function baseInput(bytes: Buffer) {
  return {
    actor,
    organizationId: "607bd187-2fec-4868-8d86-adf763844d31",
    propertyId: "c0fca11f-2676-40db-9cc8-badf8e880021",
    idempotencyKey: "asset-upload-12345678",
    contentSha256: digest(bytes),
    stream: Readable.from(bytes)
  };
}

describe("PropertyAssetUploadService", () => {
  it("creates a canonical immutable image key without trusting a browser path", async () => {
    const storage = new RecordingStorage();
    const bytes = Buffer.from("RIFF0000WEBPvalid-image-content");
    const result = await new PropertyAssetUploadService(storage).storeImage({
      ...baseInput(bytes),
      contentType: "image/webp"
    });

    expect(result.objectKey).toMatch(
      /^properties\/607bd187-2fec-4868-8d86-adf763844d31\/c0fca11f-2676-40db-9cc8-badf8e880021\/media\/[a-f0-9]{64}\.webp$/
    );
    expect(storage.input?.maxBytes).toBe(MAX_PROPERTY_IMAGE_BYTES);
    expect(storage.input?.cacheControl).toContain("immutable");
    expect(storage.bytes).toEqual(bytes);
  });

  it("stores physical room photos in a room-scoped immutable namespace", async () => {
    const storage = new RecordingStorage();
    const bytes = Buffer.from("RIFF0000WEBPoptimized-room-image");
    const physicalUnitId = "4f30c90b-e9d3-4f7a-a151-a98196aee8f7";
    const result = await new PropertyAssetUploadService(storage).storePhysicalUnitImage({
      ...baseInput(bytes),
      physicalUnitId,
      contentType: "image/webp"
    });

    expect(result.objectKey).toMatch(
      new RegExp(`/physical-units/${physicalUnitId}/media/[a-f0-9]{64}\\.webp$`)
    );
    expect(storage.input?.maxBytes).toBe(MAX_PROPERTY_IMAGE_BYTES);
    expect(storage.bytes).toEqual(bytes);
  });

  it("places compliance PDFs in the private namespace and strips supplied paths", async () => {
    const storage = new RecordingStorage();
    const bytes = Buffer.from("%PDF-1.7 safe-test");
    const result = await new PropertyAssetUploadService(storage).storeDocument({
      ...baseInput(bytes),
      contentType: "application/pdf",
      documentType: "OWNERSHIP_PROOF",
      originalFilename: "../../Ownership Proof.pdf"
    });

    expect(result.asset.objectKey).toMatch(
      /^private\/property-documents\/607bd187-2fec-4868-8d86-adf763844d31\/c0fca11f-2676-40db-9cc8-badf8e880021\/[a-f0-9]{64}\.pdf$/
    );
    expect(result.originalFilename).toBe("Ownership Proof.pdf");
    expect(storage.input?.maxBytes).toBe(MAX_PROPERTY_DOCUMENT_BYTES);
    expect(storage.input?.cacheControl).toBe("private, no-store");
  });

  it("rejects unapproved MIME types and malformed content digests before storage", async () => {
    const storage = new RecordingStorage();
    const bytes = Buffer.from("not-an-image");
    const service = new PropertyAssetUploadService(storage);

    await expect(
      service.storeImage({ ...baseInput(bytes), contentType: "image/svg+xml" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      service.storeDocument({
        ...baseInput(bytes),
        contentType: "application/pdf",
        contentSha256: "not-a-digest",
        documentType: "LEASE_AGREEMENT",
        originalFilename: "lease.pdf"
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      service.storeDocument({
        ...baseInput(bytes),
        contentType: "application/pdf",
        contentSha256: digest(bytes).toUpperCase(),
        documentType: "LEASE_AGREEMENT",
        originalFilename: "lease.pdf"
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(storage.input).toBeNull();
  });

  it("rejects bytes that do not match an approved MIME type", async () => {
    const storage = new RecordingStorage();
    const bytes = Buffer.from("<html>not an image</html>");

    await expect(
      new PropertyAssetUploadService(storage).storeImage({
        ...baseInput(bytes),
        contentType: "image/jpeg"
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("Firebase property asset stream verification", () => {
  it("rejects a stream immediately after its byte limit", async () => {
    const bytes = Buffer.from("123456789");
    const verifier = new AssetVerifier(8, digest(bytes));

    await expect(
      pipeline(
        Readable.from(bytes),
        verifier,
        new Writable({
          write(_chunk, _encoding, done) {
            done();
          }
        })
      )
    ).rejects.toBeInstanceOf(PropertyAssetTooLargeError);
  });

  it("rejects a completed stream whose digest does not match", async () => {
    const bytes = Buffer.from("verified-content");
    const verifier = new AssetVerifier(1024, "0".repeat(64));
    await pipeline(
      Readable.from(bytes),
      verifier,
      new Writable({
        write(_chunk, _encoding, done) {
          done();
        }
      })
    );

    expect(() => verifier.result()).toThrow(PropertyAssetIntegrityError);
  });
});
