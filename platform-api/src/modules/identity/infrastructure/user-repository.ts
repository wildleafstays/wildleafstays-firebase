import { randomUUID } from "node:crypto";
import type { Kysely, Selectable } from "kysely";
import type { Database, UsersTable } from "../../../infrastructure/database/types.js";
import type { VerifiedIdentity } from "../../../infrastructure/identity/identity-verifier.js";

export type UserRecord = Selectable<UsersTable>;

export class UserRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async upsertFromIdentity(identity: VerifiedIdentity): Promise<UserRecord> {
    return this.db
      .insertInto("users")
      .values({
        id: randomUUID(),
        auth_provider: identity.provider,
        auth_subject: identity.subject,
        email: identity.email,
        display_name: identity.displayName,
        email_verified: identity.emailVerified,
        status: "ACTIVE"
      })
      .onConflict((conflict) =>
        conflict.columns(["auth_provider", "auth_subject"]).doUpdateSet({
          email: identity.email,
          display_name: identity.displayName,
          email_verified: identity.emailVerified,
          updated_at: new Date()
        })
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  }
}
