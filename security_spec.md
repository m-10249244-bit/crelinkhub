# JAYTINSTORE Firestore Security Specification

## 1. Data Invariants
1. **Strict Ownership**: Every entry under `/users/{userId}/entries/{entryId}` and settings document under `/users/{userId}/meta/{settingId}` belongs strictly to `userId` (`ownerId == userId == request.auth.uid`) with `email_verified == true`.
2. **Valid Entry Types & Columns**: `kind` must be `'link' | 'folder' | 'section'` and `columnId` must be `'CRE' | 'JAY' | 'OTHER'`.
3. **URL Safety**: Link entries must store an `http://` or `https://` URL (`size >= 8 && size <= 2048`), blocking `javascript:` or `data:` payloads. Non-link entries must store an empty URL (`''`) and `clicks == 0`.
4. **Referential Integrity**: Any nested entry with a non-empty `parentId` must not reference itself (`parentId != entryId`) and must reference an existing (or batch-created) `'folder'` or `'section'` document under `/users/{userId}/entries/{parentId}`. Folders (`kind == 'folder'`) remain top-level (`parentId == ''`).
5. **Immutable Identity & Timestamps**: `ownerId`, `kind`, and `createdAt` cannot be modified after creation; `createdAt` (on create) and `updatedAt` (on create/update) must equal `request.time`.
6. **Strict Field Allowlisting**: No unverified shadow fields may be added on create or update (`hasAll` + `hasOnly`, plus `affectedKeys().hasOnly(...)`).

## 2. The "Dirty Dozen" Attack Payloads (Must Return PERMISSION_DENIED)
1. **Unauthenticated read/write**: `auth = null` attempting `get`, `list`, `create`, `update`, `delete` on `/users/u1/entries/e1`.
2. **Unverified email spoofing**: `auth = { uid: 'u1', token: { email_verified: false } }` attempting to read or write `/users/u1/entries/e1`.
3. **Cross-user access**: `auth = { uid: 'attacker', token: { email_verified: true } }` attempting to read or write `/users/victim/entries/e1`.
4. **Identity spoofing on create**: `u1` creating `/users/u1/entries/e1` with `ownerId: 'victim'`.
5. **Shadow / ghost field injection**: `u1` creating `/users/u1/entries/e1` with extra field `isAdmin: true`.
6. **Oversized ID poisoning**: `u1` writing to `/users/u1/entries/` + 200-char ID or invalid characters (`../bad`).
7. **XSS / `javascript:` URL injection**: `u1` creating a link with `url: 'javascript:alert(1)'`.
8. **Empty or oversized title**: `u1` creating an entry with `title: ''` or `title` > 80 chars.
9. **Orphaned / invalid parent reference**: `u1` creating an entry with `parentId: 'missing-folder-id'`, `parentId == entryId` (self-parent), or pointing `parentId` to a `'link'` document.
10. **Client-forged timestamp**: `u1` creating or updating an entry with a past `createdAt` / `updatedAt` instead of `request.time`.
11. **Immutable field mutation**: `u1` updating an entry to change `kind` (`'link'` -> `'folder'`) or `ownerId` or `createdAt`.
12. **Type/value poisoning on update**: `u1` updating `clicks` to `-5` or `"NaN"`, `sortOrder` to `NaN`/`Infinity`, or `isOpen` to `"true"` string.

## 3. Red Team Audit Delta Report
- **Added Self-Parent Guard**: `incoming().parentId != entryId` on `create` and `update`.
- **Added Container Kind Check**: `isValidParentContainer(userId, incoming().parentId)` verifies via `get` / `getAfter` that the parent document is actually a `'folder'` or `'section'`, blocking nesting inside a `'link'`.
- **Added Folder Top-Level Constraint**: `data.kind != 'folder' || data.parentId == ''`.
- **Added Finite SortOrder & Clicks Bounds**: `data.sortOrder >= -1000000 && data.sortOrder <= 1000000000` (blocks `NaN` / `Infinity`) and `(data.kind == 'link' || data.clicks == 0)` with `data.clicks <= 1000000000`.
