# JAYTINSTORE Firestore Security Specification

## 1. Data Invariants
1. **Public Read-Only Viewing / Authenticated Editor Writes**: Visitors without login (`auth == null`) may `get` and `list` public entries under `/vault/main/entries/{entryId}` and `/vault/main/meta/columns` where `isPublic == true`. Only verified vault editors (`isVaultEditor()`) may `create`, `update`, or `delete` documents under `/vault/main/...`.
2. **Legacy Per-User Isolation**: Legacy `/users/{userId}/entries/{entryId}` and `/users/{userId}/meta/{settingId}` remain strictly isolated to `ownerId == userId == request.auth.uid` with `email_verified == true`.
3. **Valid Entry Types & Columns**: `kind` must be `'link' | 'folder' | 'section'` and `columnId` must be `'CRE' | 'JAY' | 'OTHER'`.
4. **URL Safety**: Link entries must store an `http://` or `https://` URL (`size >= 8 && size <= 2048`), blocking `javascript:` or `data:` payloads. Non-link entries must store an empty URL (`''`) and `clicks == 0`.
5. **Referential Integrity**: Any nested entry with a non-empty `parentId` must not reference itself (`parentId != entryId`) and must reference an existing (or batch-created) `'folder'` or `'section'` document in the same vault. Folders (`kind == 'folder'`) remain top-level (`parentId == ''`).
6. **Immutable Identity & Timestamps**: `ownerId`, `isPublic`, `kind`, and `createdAt` cannot be modified after creation; `createdAt` (on create) and `updatedAt` (on create/update) must equal `request.time`.

## 2. The "Dirty Dozen" Attack Payloads (Must Return PERMISSION_DENIED)
1. **Unauthenticated write**: `auth = null` attempting `create`, `update`, or `delete` on `/vault/main/entries/e1`.
2. **Unverified email spoofing**: `auth = { uid: 'u1', token: { email: 'm-10249244@moe-dl.edu.my', email_verified: false } }` attempting to write `/vault/main/entries/e1`.
3. **Non-editor authenticated write**: `auth = { uid: 'stranger', token: { email: 'stranger@example.com', email_verified: true } }` attempting to write `/vault/main/entries/e1`.
4. **Identity spoofing on create**: Editor creating `/vault/main/entries/e1` with `ownerId: 'victim'`.
5. **Shadow / ghost field injection**: Editor creating `/vault/main/entries/e1` with extra field `isAdmin: true`.
6. **Oversized ID poisoning**: Editor writing to `/vault/main/entries/` + 200-char ID or invalid characters (`../bad`).
7. **XSS / `javascript:` URL injection**: Editor creating a link with `url: 'javascript:alert(1)'`.
8. **Empty or oversized title**: Editor creating an entry with `title: ''` or `title` > 80 chars.
9. **Orphaned / invalid / self parent reference**: Editor creating an entry with `parentId: 'missing-folder-id'`, `parentId == entryId`, or pointing `parentId` to a `'link'` document.
10. **Client-forged timestamp**: Editor creating or updating an entry with a past `createdAt` / `updatedAt` instead of `request.time`.
11. **Immutable field mutation**: Editor updating an entry to change `kind`, `ownerId`, `isPublic`, or `createdAt`.
12. **Type/value poisoning on update**: Editor updating `clicks` to `-5` or `"NaN"`, `sortOrder` to `NaN`/`Infinity`, or `isOpen` to `"true"` string.
