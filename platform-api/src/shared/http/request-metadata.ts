import type { FastifyRequest } from "fastify";

export interface RequestMetadata {
  requestId: string;
  correlationId: string;
  source: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export function requestMetadata(request: FastifyRequest, source: string): RequestMetadata {
  return {
    requestId: request.id,
    correlationId: request.correlationId,
    source,
    ipAddress: request.ip || null,
    userAgent: request.headers["user-agent"] ?? null
  };
}
