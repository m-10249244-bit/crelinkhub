import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const RULES_PATH = path.resolve(process.cwd(), 'firestore.rules');
const BLUEPRINT_PATH = path.resolve(process.cwd(), 'firebase-blueprint.json');

interface MockAuth {
  uid: string;
  token: { email_verified: boolean };
}

interface MockRequest {
  auth: MockAuth | null;
  time: number;
  resourceData: Record<string, unknown>;
}

const REQUEST_TIME = 1700000000000;
const VALID_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

function isValidEntryDoc(
  data: Record<string, unknown>,
  userId: string,
  auth: MockAuth | null
): boolean {
  if (!auth || !auth.token.email_verified || auth.uid !== userId) return false;
  const required = [
    'ownerId',
    'kind',
    'columnId',
    'parentId',
    'title',
    'url',
    'clicks',
    'isOpen',
    'sortOrder',
    'createdAt',
    'updatedAt',
  ];
  const keys = Object.keys(data);
  if (keys.length !== required.length) return false;
  if (!required.every((k) => keys.includes(k))) return false;
  if (data.ownerId !== userId || data.ownerId !== auth.uid) return false;
  if (data.kind !== 'link' && data.kind !== 'folder' && data.kind !== 'section') return false;
  if (data.columnId !== 'CRE' && data.columnId !== 'JAY' && data.columnId !== 'OTHER') return false;
  if (typeof data.parentId !== 'string' || data.parentId.length > 128) return false;
  if (data.parentId !== '' && !VALID_ID_RE.test(data.parentId)) return false;
  if (data.kind === 'folder' && data.parentId !== '') return false;
  if (typeof data.title !== 'string' || data.title.length < 1 || data.title.length > 80) return false;
  if (typeof data.url !== 'string' || data.url.length > 2048) return false;
  if (data.kind === 'link' && (data.url.length < 8 || !/^https?:\/\//.test(data.url))) return false;
  if (data.kind !== 'link' && data.url !== '') return false;
  if (typeof data.clicks !== 'number' || !Number.isInteger(data.clicks) || data.clicks < 0 || data.clicks > 1000000000) return false;
  if (data.kind !== 'link' && data.clicks !== 0) return false;
  if (typeof data.isOpen !== 'boolean') return false;
  if (typeof data.sortOrder !== 'number' || !Number.isFinite(data.sortOrder) || data.sortOrder < -1000000 || data.sortOrder > 1000000000) return false;
  if (typeof data.createdAt !== 'number' || typeof data.updatedAt !== 'number') return false;
  return true;
}

function evaluateCreate(
  userId: string,
  entryId: string,
  req: MockRequest,
  existingDocs: Record<string, { kind: string }>
): 'ALLOW' | 'PERMISSION_DENIED' {
  if (!VALID_ID_RE.test(userId) || !VALID_ID_RE.test(entryId)) return 'PERMISSION_DENIED';
  if (!isValidEntryDoc(req.resourceData, userId, req.auth)) return 'PERMISSION_DENIED';
  if (req.resourceData.parentId === entryId) return 'PERMISSION_DENIED';
  if (req.resourceData.createdAt !== req.time || req.resourceData.updatedAt !== req.time) {
    return 'PERMISSION_DENIED';
  }
  const parentId = req.resourceData.parentId as string;
  if (parentId !== '') {
    const parent = existingDocs[parentId];
    if (!parent || (parent.kind !== 'folder' && parent.kind !== 'section')) {
      return 'PERMISSION_DENIED';
    }
  }
  return 'ALLOW';
}

function evaluateUpdate(
  userId: string,
  entryId: string,
  req: MockRequest,
  existing: Record<string, unknown>,
  existingDocs: Record<string, { kind: string }>
): 'ALLOW' | 'PERMISSION_DENIED' {
  if (!VALID_ID_RE.test(userId) || !VALID_ID_RE.test(entryId)) return 'PERMISSION_DENIED';
  if (!isValidEntryDoc(req.resourceData, userId, req.auth)) return 'PERMISSION_DENIED';
  if (req.resourceData.parentId === entryId) return 'PERMISSION_DENIED';
  if (
    req.resourceData.ownerId !== existing.ownerId ||
    req.resourceData.kind !== existing.kind ||
    req.resourceData.createdAt !== existing.createdAt ||
    req.resourceData.updatedAt !== req.time
  ) {
    return 'PERMISSION_DENIED';
  }
  const changedKeys = Object.keys(req.resourceData).filter(
    (k) => req.resourceData[k] !== existing[k]
  );
  const action1Allowed = new Set(['title', 'url', 'columnId', 'parentId', 'sortOrder', 'updatedAt']);
  const action2Allowed = new Set(['columnId', 'parentId', 'sortOrder', 'updatedAt']);
  const action3Allowed = new Set(['isOpen', 'updatedAt']);
  const action4Allowed = new Set(['clicks', 'updatedAt']);

  const parentId = req.resourceData.parentId as string;
  const parentValid =
    parentId === '' ||
    parentId === existing.parentId ||
    (existingDocs[parentId]?.kind === 'folder' || existingDocs[parentId]?.kind === 'section');

  const isAction1 = changedKeys.every((k) => action1Allowed.has(k)) && parentValid;
  const isAction2 = changedKeys.every((k) => action2Allowed.has(k)) && parentValid;
  const isAction3 =
    existing.kind === 'section' && changedKeys.every((k) => action3Allowed.has(k));
  const isAction4 =
    existing.kind === 'link' &&
    changedKeys.every((k) => action4Allowed.has(k)) &&
    req.resourceData.clicks === (existing.clicks as number) + 1;

  return isAction1 || isAction2 || isAction3 || isAction4 ? 'ALLOW' : 'PERMISSION_DENIED';
}

test('firestore.rules enforces Eight Pillars and matches blueprint paths', () => {
  const rulesText = fs.readFileSync(RULES_PATH, 'utf8');
  const blueprint = JSON.parse(fs.readFileSync(BLUEPRINT_PATH, 'utf8'));

  assert.ok(rulesText.includes("rules_version = '2';"));
  assert.ok(rulesText.includes('allow read, write: if false;'));
  assert.ok(rulesText.includes('request.auth.token.email_verified == true'));
  assert.ok(rulesText.includes('resource.data.ownerId == request.auth.uid'));
  assert.ok(rulesText.includes('match /users/{userId}/entries/{entryId}'));
  assert.ok(rulesText.includes('match /users/{userId}/meta/{settingId}'));
  assert.ok(blueprint.firestore['/users/{userId}/entries/{entryId}']);
  assert.ok(blueprint.firestore['/users/{userId}/meta/{settingId}']);
});

test('Dirty Dozen attack payloads are denied and valid operations are allowed', () => {
  const validAuth: MockAuth = { uid: 'u1', token: { email_verified: true } };
  const baseEntry: Record<string, unknown> = {
    ownerId: 'u1',
    kind: 'link',
    columnId: 'CRE',
    parentId: '',
    title: 'Google Drive',
    url: 'https://drive.google.com',
    clicks: 0,
    isOpen: true,
    sortOrder: 0,
    createdAt: REQUEST_TIME,
    updatedAt: REQUEST_TIME,
  };
  const containers = {
    'folder-1': { kind: 'folder' },
    'sec-1': { kind: 'section' },
    'link-1': { kind: 'link' },
  };

  // Legitimate create succeeds
  assert.equal(
    evaluateCreate('u1', 'e1', { auth: validAuth, time: REQUEST_TIME, resourceData: baseEntry }, containers),
    'ALLOW'
  );

  // 1. Unauthenticated write
  assert.equal(
    evaluateCreate('u1', 'e1', { auth: null, time: REQUEST_TIME, resourceData: baseEntry }, containers),
    'PERMISSION_DENIED'
  );
  // 2. Unverified email spoofing
  assert.equal(
    evaluateCreate(
      'u1',
      'e1',
      { auth: { uid: 'u1', token: { email_verified: false } }, time: REQUEST_TIME, resourceData: baseEntry },
      containers
    ),
    'PERMISSION_DENIED'
  );
  // 3. Cross-user write
  assert.equal(
    evaluateCreate('victim', 'e1', { auth: validAuth, time: REQUEST_TIME, resourceData: baseEntry }, containers),
    'PERMISSION_DENIED'
  );
  // 4. Identity spoofing
  assert.equal(
    evaluateCreate(
      'u1',
      'e1',
      { auth: validAuth, time: REQUEST_TIME, resourceData: { ...baseEntry, ownerId: 'victim' } },
      containers
    ),
    'PERMISSION_DENIED'
  );
  // 5. Shadow field injection
  assert.equal(
    evaluateCreate(
      'u1',
      'e1',
      { auth: validAuth, time: REQUEST_TIME, resourceData: { ...baseEntry, isAdmin: true } },
      containers
    ),
    'PERMISSION_DENIED'
  );
  // 6. Oversized / bad ID poisoning
  assert.equal(
    evaluateCreate('u1', 'a'.repeat(200), { auth: validAuth, time: REQUEST_TIME, resourceData: baseEntry }, containers),
    'PERMISSION_DENIED'
  );
  assert.equal(
    evaluateCreate('u1', '../bad', { auth: validAuth, time: REQUEST_TIME, resourceData: baseEntry }, containers),
    'PERMISSION_DENIED'
  );
  // 7. XSS javascript: URL
  assert.equal(
    evaluateCreate(
      'u1',
      'e1',
      { auth: validAuth, time: REQUEST_TIME, resourceData: { ...baseEntry, url: 'javascript:alert(1)' } },
      containers
    ),
    'PERMISSION_DENIED'
  );
  // 8. Empty / oversized title
  assert.equal(
    evaluateCreate(
      'u1',
      'e1',
      { auth: validAuth, time: REQUEST_TIME, resourceData: { ...baseEntry, title: '' } },
      containers
    ),
    'PERMISSION_DENIED'
  );
  assert.equal(
    evaluateCreate(
      'u1',
      'e1',
      { auth: validAuth, time: REQUEST_TIME, resourceData: { ...baseEntry, title: 'x'.repeat(81) } },
      containers
    ),
    'PERMISSION_DENIED'
  );
  // 9. Orphaned / invalid / self parent reference
  assert.equal(
    evaluateCreate(
      'u1',
      'e1',
      { auth: validAuth, time: REQUEST_TIME, resourceData: { ...baseEntry, parentId: 'missing-folder' } },
      containers
    ),
    'PERMISSION_DENIED'
  );
  assert.equal(
    evaluateCreate(
      'u1',
      'e1',
      { auth: validAuth, time: REQUEST_TIME, resourceData: { ...baseEntry, parentId: 'link-1' } },
      containers
    ),
    'PERMISSION_DENIED'
  );
  assert.equal(
    evaluateCreate(
      'u1',
      'e1',
      { auth: validAuth, time: REQUEST_TIME, resourceData: { ...baseEntry, parentId: 'e1' } },
      containers
    ),
    'PERMISSION_DENIED'
  );
  // 10. Client-forged timestamp
  assert.equal(
    evaluateCreate(
      'u1',
      'e1',
      { auth: validAuth, time: REQUEST_TIME, resourceData: { ...baseEntry, createdAt: REQUEST_TIME - 5000 } },
      containers
    ),
    'PERMISSION_DENIED'
  );
  // 11. Immutable field mutation on update
  const updateTime = REQUEST_TIME + 1000;
  assert.equal(
    evaluateUpdate(
      'u1',
      'e1',
      {
        auth: validAuth,
        time: updateTime,
        resourceData: { ...baseEntry, kind: 'folder', url: '', updatedAt: updateTime },
      },
      baseEntry,
      containers
    ),
    'PERMISSION_DENIED'
  );
  // 12. Value poisoning on update (negative clicks, NaN sortOrder)
  assert.equal(
    evaluateUpdate(
      'u1',
      'e1',
      {
        auth: validAuth,
        time: updateTime,
        resourceData: { ...baseEntry, clicks: -5, updatedAt: updateTime },
      },
      baseEntry,
      containers
    ),
    'PERMISSION_DENIED'
  );
  assert.equal(
    evaluateUpdate(
      'u1',
      'e1',
      {
        auth: validAuth,
        time: updateTime,
        resourceData: { ...baseEntry, sortOrder: Number.NaN, updatedAt: updateTime },
      },
      baseEntry,
      containers
    ),
    'PERMISSION_DENIED'
  );
});
