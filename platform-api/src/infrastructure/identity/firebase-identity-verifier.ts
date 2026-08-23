import { getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import type { IdentityVerifier, VerifiedIdentity } from "./identity-verifier.js";

export class FirebaseIdentityVerifier implements IdentityVerifier {
  private readonly auth: Auth;

  constructor(projectId: string) {
    const app: App = getApps()[0] ?? initializeApp({ projectId });
    this.auth = getAuth(app);
  }

  async verifyIdToken(token: string): Promise<VerifiedIdentity> {
    const decoded = await this.auth.verifyIdToken(token, true);
    const displayNameClaim = decoded["name"];
    return {
      provider: "firebase",
      subject: decoded.uid,
      email: typeof decoded.email === "string" ? decoded.email.toLowerCase() : null,
      displayName: typeof displayNameClaim === "string" ? displayNameClaim : null,
      emailVerified: decoded.email_verified === true
    };
  }
}
