/**
 * Security Rules Verification Spec (Phase 0 TDD)
 * Documents the 12 adversarial test cases ("Dirty Dozen") enforced by firestore.rules.
 * Can be executed against the Firebase Emulator Suite with @firebase/rules-unit-testing.
 */

export interface DirtyDozenCase {
  id: number;
  name: string;
  operation: 'create' | 'update' | 'get' | 'delete';
  path: string;
  actor: {
    uid: string;
    email: string;
    email_verified: boolean;
    isAdmin: boolean;
  };
  payload?: Record<string, unknown>;
  expected: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_CASES: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Self-Balance Inflation on Create',
    operation: 'create',
    path: '/users/citizen_1',
    actor: { uid: 'citizen_1', email: 'c1@example.com', email_verified: true, isAdmin: false },
    payload: {
      uid: 'citizen_1',
      characterName: 'Carlos Mendes',
      alias: 'cmendes',
      origin: 'comerciante',
      district: 'distrito-central',
      coatColor: '#1E293B',
      accentColor: '#D97706',
      skinTone: '#D4A373',
      style: 'executivo',
      level: 1,
      reputation: 0,
      cashBalance: 999999,
      bankBalance: 500000,
      status: 'active',
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Self-Balance Mutation on Update',
    operation: 'update',
    path: '/users/citizen_1',
    actor: { uid: 'citizen_1', email: 'c1@example.com', email_verified: true, isAdmin: false },
    payload: { cashBalance: 25000 },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Shadow Field Injection (role/isAdmin)',
    operation: 'create',
    path: '/users/citizen_1',
    actor: { uid: 'citizen_1', email: 'c1@example.com', email_verified: true, isAdmin: false },
    payload: { uid: 'citizen_1', role: 'super_admin', isAdmin: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Self-Grant Admin Document',
    operation: 'create',
    path: '/admins/citizen_1',
    actor: { uid: 'citizen_1', email: 'c1@example.com', email_verified: true, isAdmin: false },
    payload: { uid: 'citizen_1', role: 'super_admin', label: 'Fake Admin', grantedBy: 'citizen_1' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Cross-User Identity Spoofing',
    operation: 'create',
    path: '/users/citizen_2',
    actor: { uid: 'citizen_1', email: 'c1@example.com', email_verified: true, isAdmin: false },
    payload: { uid: 'citizen_2', characterName: 'Spoofed User' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Unverified Email Admin Spoof',
    operation: 'update',
    path: '/economyConfig/global',
    actor: { uid: 'spoof_uid', email: 'luuhvieeira@gmail.com', email_verified: false, isAdmin: false },
    payload: { taxRatePercent: 0 },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'PII Cross-User Read',
    operation: 'get',
    path: '/users/citizen_2/private/account',
    actor: { uid: 'citizen_1', email: 'c1@example.com', email_verified: true, isAdmin: false },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Economy Base Price Tampering by Citizen',
    operation: 'update',
    path: '/economyConfig/global',
    actor: { uid: 'citizen_1', email: 'c1@example.com', email_verified: true, isAdmin: false },
    payload: { baseSalaryHourly: 9999 },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Audit Log Deletion Even by Admin',
    operation: 'delete',
    path: '/adminAuditLogs/log_001',
    actor: { uid: 'owner_uid', email: 'luuhvieeira@gmail.com', email_verified: true, isAdmin: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Client Timestamp Forgery',
    operation: 'create',
    path: '/users/citizen_1',
    actor: { uid: 'citizen_1', email: 'c1@example.com', email_verified: true, isAdmin: false },
    payload: { createdAt: '2020-01-01T00:00:00Z' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Path ID Poisoning & Oversized Character Name',
    operation: 'create',
    path: '/users/' + 'a'.repeat(200),
    actor: { uid: 'citizen_1', email: 'c1@example.com', email_verified: true, isAdmin: false },
    payload: { characterName: 'x'.repeat(250) },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Suspended Citizen Self-Reactivation',
    operation: 'update',
    path: '/users/citizen_1',
    actor: { uid: 'citizen_1', email: 'c1@example.com', email_verified: true, isAdmin: false },
    payload: { status: 'active' },
    expected: 'PERMISSION_DENIED',
  },
];
