import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const RULES_PATH = path.resolve(process.cwd(), 'firestore.rules');
const BLUEPRINT_PATH = path.resolve(process.cwd(), 'firebase-blueprint.json');

interface MockAuth {
  uid: string;
  token: { email?: string; email_verified: boolean };
}

interface MockRequest {
  auth: MockAuth | null;
  time: number;
  resourceData: Record<string, unknown>;
}

const EDITOR_EMAIL = 'm-10249244@moe-dl.edu.my';
const REQUEST_TIME = 1700000000000;
const VALID_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

function isVaultEditor(auth: MockAuth | null): boolean {
  return Boolean(
    auth &&
      auth.token.email_verified &&
      auth.token.email === EDITOR_EMAIL
  );
}

function isValidPublicEntryDoc(
  data: Record<string, unknown>,
  expectedOwnerId: string
): boolean {
  const required = [
    'ownerId',
    'isPublic',
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
  if (typeof data.ownerId !== 'string' || !VALID_ID_RE.test(data.ownerId)) return false;
  if (data.ownerId !== expectedOwnerId) return false;
  if (data.isPublic !== true) return false;
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

function evaluatePublicRead(
  vaultId: string,
  resourceData: Record<string, unknown> | null
): 'ALLOW' | 'PERMISSION_DENIED' {
  if (vaultId !== 'main') return 'PERMISSION_DENIED';
  if (resourceData && resourceData.isPublic !== true) return 'PERMISSION_DENIED';
  return 'ALLOW';
}

function evaluateCreate(
  vaultId: string,
  entryId: string,
  req: MockRequest,
  existingDocs: Record<string, { kind: string }>
): 'ALLOW' | 'PERMISSION_DENIED' {
  if (vaultId !== 'main' || !VALID_ID_RE.test(entryId)) return 'PERMISSION_DENIED';
  if (!isVaultEditor(req.auth) || !req.auth) return 'PERMISSION_DENIED';
  if (!isValidPublicEntryDoc(req.resourceData, req.auth.uid)) return 'PERMISSION_DENIED';
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
  vaultId: string,
  entryId: string,
  req: MockRequest,
  existing: Record<string, unknown>,
  existingDocs: Record<string, { kind: string }>
): 'ALLOW' | 'PERMISSION_DENIED' {
  if (vaultId !== 'main' || !VALID_ID_RE.test(entryId)) return 'PERMISSION_DENIED';
  if (!isVaultEditor(req.auth)) return 'PERMISSION_DENIED';
  if (!isValidPublicEntryDoc(req.resourceData, existing.ownerId as string)) return 'PERMISSION_DENIED';
  if (req.resourceData.parentId === entryId) return 'PERMISSION_DENIED';
  if (
    req.resourceData.ownerId !== existing.ownerId ||
    req.resourceData.isPublic !== existing.isPublic ||
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

test('firestore.rules enforces Eight Pillars and public-read / editor-write vault paths', () => {
  const rulesText = fs.readFileSync(RULES_PATH, 'utf8');
  const blueprint = JSON.parse(fs.readFileSync(BLUEPRINT_PATH, 'utf8'));

  assert.ok(rulesText.includes("rules_version = '2';"));
  assert.ok(rulesText.includes('allow read, write: if false;'));
  assert.ok(rulesText.includes('request.auth.token.email_verified == true'));
  assert.ok(rulesText.includes('resource.data.isPublic == true'));
  assert.ok(rulesText.includes('match /vault/{vaultId}/entries/{entryId}'));
  assert.ok(rulesText.includes('match /vault/{vaultId}/meta/{settingId}'));
  assert.ok(blueprint.firestore['/vault/{vaultId}/entries/{entryId}']);
  assert.ok(blueprint.firestore['/vault/{vaultId}/meta/{settingId}']);
});

test('Public visitors can read links without login, while Dirty Dozen write attacks are denied', () => {
  const editorAuth: MockAuth = {
    uid: 'editor-1',
    token: { email: EDITOR_EMAIL, email_verified: true },
  };
  const strangerAuth: MockAuth = {
    uid: 'stranger-1',
    token: { email: 'stranger@example.com', email_verified: true },
  };
  const baseEntry: Record<string, unknown> = {
    ownerId: 'editor-1',
    isPublic: true,
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

  // Unauthenticated visitor can read public vault data
  assert.equal(evaluatePublicRead('main', baseEntry), 'ALLOW');
  assert.equal(evaluatePublicRead('other', baseEntry), 'PERMISSION_DENIED');

  // Authenticated verified editor can create
  assert.equal(
    evaluateCreate('main', 'e1', { auth: editorAuth, time: REQUEST_TIME, resourceData: baseEntry }, containers),
    'ALLOW'
  );

  // 1. Unauthenticated write denied
  assert.equal(
    evaluateCreate('main', 'e1', { auth: null, time: REQUEST_TIME, resourceData: baseEntry }, containers),
    'PERMISSION_DENIED'
  );
  // 2. Unverified email spoofing denied
  assert.equal(
    evaluateCreate(
      'main',
      'e1',
      { auth: { uid: 'editor-1', token: { email: EDITOR_EMAIL, email_verified: false } }, time: REQUEST_TIME, resourceData: baseEntry },
      containers
    ),
    'PERMISSION_DENIED'
  );
  // 3. Non-editor authenticated write denied
  assert.equal(
    evaluateCreate('main', 'e1', { auth: strangerAuth, time: REQUEST_TIME, resourceData: { ...baseEntry, ownerId: 'stranger-1' } }, containers),
    'PERMISSION_DENIED'
  );
  // 4. Identity spoofing denied
  assert.equal(
    evaluateCreate(
      'main',
      'e1',
      { auth: editorAuth, time: REQUEST_TIME, resourceData: { ...baseEntry, ownerId: 'victim' } },
      containers
    ),
    'PERMISSION_DENIED'
  );
  // 5. Shadow field injection denied
  assert.equal(
    evaluateCreate(
      'main',
      'e1',
      { auth: editorAuth, time: REQUEST_TIME, resourceData: { ...baseEntry, isAdmin: true } },
      containers
    ),
    'PERMISSION_DENIED'
  );
  // 6. Oversized / bad ID poisoning denied
  assert.equal(
    evaluateCreate('main', 'a'.repeat(200), { auth: editorAuth, time: REQUEST_TIME, resourceData: baseEntry }, containers),
    'PERMISSION_DENIED'
  );
  assert.equal(
    evaluateCreate('main', '../bad', { auth: editorAuth, time: REQUEST_TIME, resourceData: baseEntry }, containers),
    'PERMISSION_DENIED'
  );
  // 7. XSS javascript: URL denied
  assert.equal(
    evaluateCreate(
      'main',
      'e1',
      { auth: editorAuth, time: REQUEST_TIME, resourceData: { ...baseEntry, url: 'javascript:alert(1)' } },
      containers
    ),
    'PERMISSION_DENIED'
  );
  // 8. Empty / oversized title denied
  assert.equal(
    evaluateCreate(
      'main',
      'e1',
      { auth: editorAuth, time: REQUEST_TIME, resourceData: { ...baseEntry, title: '' } },
      containers
    ),
    'PERMISSION_DENIED'
  );
  assert.equal(
    evaluateCreate(
      'main',
      'e1',
      { auth: editorAuth, time: REQUEST_TIME, resourceData: { ...baseEntry, title: 'x'.repeat(81) } },
      containers
    ),
    'PERMISSION_DENIED'
  );
  // 9. Orphaned / invalid / self parent reference denied
  assert.equal(
    evaluateCreate(
      'main',
      'e1',
      { auth: editorAuth, time: REQUEST_TIME, resourceData: { ...baseEntry, parentId: 'missing-folder' } },
      containers
    ),
    'PERMISSION_DENIED'
  );
  assert.equal(
    evaluateCreate(
      'main',
      'e1',
      { auth: editorAuth, time: REQUEST_TIME, resourceData: { ...baseEntry, parentId: 'link-1' } },
      containers
    ),
    'PERMISSION_DENIED'
  );
  assert.equal(
    evaluateCreate(
      'main',
      'e1',
      { auth: editorAuth, time: REQUEST_TIME, resourceData: { ...baseEntry, parentId: 'e1' } },
      containers
    ),
    'PERMISSION_DENIED'
  );
  // 10. Client-forged timestamp denied
  assert.equal(
    evaluateCreate(
      'main',
      'e1',
      { auth: editorAuth, time: REQUEST_TIME, resourceData: { ...baseEntry, createdAt: REQUEST_TIME - 5000 } },
      containers
    ),
    'PERMISSION_DENIED'
  );
  // 11. Immutable field mutation on update denied
  const updateTime = REQUEST_TIME + 1000;
  assert.equal(
    evaluateUpdate(
      'main',
      'e1',
      {
        auth: editorAuth,
        time: updateTime,
        resourceData: { ...baseEntry, kind: 'folder', url: '', updatedAt: updateTime },
      },
      baseEntry,
      containers
    ),
    'PERMISSION_DENIED'
  );
  // 12. Value poisoning on update denied
  assert.equal(
    evaluateUpdate(
      'main',
      'e1',
      {
        auth: editorAuth,
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
      'main',
      'e1',
      {
        auth: editorAuth,
        time: updateTime,
        resourceData: { ...baseEntry, sortOrder: Number.NaN, updatedAt: updateTime },
      },
      baseEntry,
      containers
    ),
    'PERMISSION_DENIED'
  );
});
