# LCE Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants

1. **Balance Immutability**: A regular player (`citizen`) can NEVER create a character with arbitrary `cashBalance != 500` or `bankBalance != 1000`, nor modify `cashBalance`, `bankBalance`, `level`, `reputation`, or `status` via client Firestore SDK updates.
2. **RBAC Authority**: No user can self-assign admin privileges or write to `/admins/{adminUid}`. Only the verified bootstrapped owner (`luuhvieeira@gmail.com` with `email_verified == true`) can create/update/delete `/admins/{adminUid}`, and admin actions require database-backed verification (`exists(/databases/$(database)/documents/admins/$(request.auth.uid))` or verified bootstrap).
3. **PII Isolation**: Email addresses live strictly inside `/users/{userId}/private/account`, readable only by the owner (`request.auth.uid == userId`) or a verified admin.
4. **Immutable Audit Trail**: `/adminAuditLogs/{logId}` is strictly append-only for verified admins (`update` and `delete` are permanently `false`).
5. **Server Timestamps**: `createdAt`, `updatedAt`, and `lastLoginAt` MUST equal `request.time`.
6. **Path & Size Hardening**: All document IDs match `^[a-zA-Z0-9_\-]+$` (max 128 chars), and all strings enforce strict length and regex bounds.

## 2. The "Dirty Dozen" Adversarial Payloads

| # | Attack Vector | Target Path | Malicious Payload | Expected Result |
|---|---------------|-------------|-------------------|-----------------|
| 1 | Self-Balance Inflation (Create) | `/users/u1` | `{ ..., cashBalance: 9999999, bankBalance: 500000 }` | `PERMISSION_DENIED` |
| 2 | Self-Balance Mutation (Update) | `/users/u1` | `{ cashBalance: 50000, updatedAt: serverTimestamp() }` | `PERMISSION_DENIED` |
| 3 | Privilege Escalation (Shadow Field) | `/users/u1` | `{ ..., role: "super_admin", isAdmin: true }` | `PERMISSION_DENIED` |
| 4 | Self-Grant Admin Document | `/admins/u1` | `{ uid: "u1", role: "super_admin", label: "Hacker" }` | `PERMISSION_DENIED` |
| 5 | Identity Spoofing | `/users/u2` (as `u1`) | `{ uid: "u2", characterName: "Fake" }` | `PERMISSION_DENIED` |
| 6 | Unverified Email Admin Spoof | `/economyConfig/global` (`email_verified: false`) | `{ taxRatePercent: 0 }` | `PERMISSION_DENIED` |
| 7 | PII Cross-User Read | `/users/u2/private/account` (as `u1`) | `GET` | `PERMISSION_DENIED` |
| 8 | Economy Tampering by Citizen | `/economyConfig/global` (as citizen `u1`) | `{ baseSalaryHourly: 9999 }` | `PERMISSION_DENIED` |
| 9 | Audit Log Tampering | `/adminAuditLogs/log1` (even as admin) | `UPDATE / DELETE` | `PERMISSION_DENIED` |
| 10 | Timestamp Forgery | `/users/u1` | `{ ..., createdAt: "2020-01-01T00:00:00Z" }` | `PERMISSION_DENIED` |
| 11 | ID Poisoning / Oversized Payload | `/users/a*300` | `{ characterName: "x".repeat(500) }` | `PERMISSION_DENIED` |
| 12 | Suspended Character Self-Reactivation | `/users/u1` (when `status == 'suspended'`) | `{ status: "active", coatColor: "#111111" }` | `PERMISSION_DENIED` |
