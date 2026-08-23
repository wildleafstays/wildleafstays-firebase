export interface VerifiedIdentity {
  provider: "firebase";
  subject: string;
  email: string | null;
  displayName: string | null;
  emailVerified: boolean;
}

export interface IdentityVerifier {
  verifyIdToken(token: string): Promise<VerifiedIdentity>;
}
