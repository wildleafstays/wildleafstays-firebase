import "fastify";
import type { ActorContext } from "../modules/access/domain/actor-context.js";

declare module "fastify" {
  interface FastifyRequest {
    actor: ActorContext | null;
    correlationId: string;
  }
}
