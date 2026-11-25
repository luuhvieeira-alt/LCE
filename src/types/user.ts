import type { Timestamp } from 'firebase/firestore';

export type AuthProviderType = 'google' | 'password';

export type AdminRole = 'super_admin' | 'economy_admin' | 'moderator';

export interface UserPrivateAccount {
  uid: string;
  email: string;
  provider: AuthProviderType;
  createdAt: Timestamp;
  lastLoginAt: Timestamp;
}

export interface AdminRecord {
  uid: string;
  role: AdminRole;
  label: string;
  grantedBy: string;
  createdAt: Timestamp;
}

export interface ServerAuthVerification {
  verified: boolean;
  uid: string;
  emailVerified: boolean;
  isBootstrappedOwner: boolean;
}

export interface AdminSessionStatus {
  isAdmin: boolean;
  role: AdminRole | null;
  label: string | null;
  isBootstrappedOwner: boolean;
  verifiedByServer: boolean;
}
