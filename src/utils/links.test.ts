import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countDescendantLinks,
  deleteEntryCascade,
  extractDomain,
  filterEntries,
  fromFirestoreEntryDoc,
  isAuthorizedEditorEmail,
  moveEntryInScope,
  moveEntryToScope,
  normalizeUrl,
  parseImportedBackup,
  reorderEntryOntoTarget,
  sanitizeEntries,
  sanitizeEntryId,
  sortEntriesByOrder,
  toFirestoreColumnPayload,
  toFirestoreEntryCreatePayload,
  validateEntryInput,
  withReindexedSortOrder,
  type VaultEntry,
} from './links';

test('normalizeUrl prepends https:// and rejects unsafe schemes', () => {
  assert.equal(normalizeUrl('notion.so'), 'https://notion.so/');
  assert.equal(normalizeUrl('  https://github.com/trending  '), 'https://github.com/trending');
  assert.equal(normalizeUrl('http://localhost:3000/test'), 'http://localhost:3000/test');
  assert.equal(normalizeUrl('javascript:alert(1)'), null);
  assert.equal(normalizeUrl('data:text/html,hi'), null);
  assert.equal(normalizeUrl('not a url'), null);
  assert.equal(normalizeUrl('   '), null);
});

test('extractDomain strips www prefix cleanly', () => {
  assert.equal(extractDomain('https://www.youtube.com/watch?v=123'), 'youtube.com');
  assert.equal(extractDomain('https://drive.google.com/drive/my-drive'), 'drive.google.com');
});

test('validateEntryInput validates links, folders, and sections properly', () => {
  const emptyLink = validateEntryInput({ kind: 'link', title: '', url: '', columnId: 'CRE' });
  assert.ok(emptyLink.title);
  assert.ok(emptyLink.url);

  const validFolder = validateEntryInput({ kind: 'folder', title: 'Work Folder', url: '', columnId: 'CRE' });
  assert.deepEqual(validFolder, {});

  const emptySection = validateEntryInput({ kind: 'section', title: '   ', url: '', columnId: 'JAY' });
  assert.ok(emptySection.title);
  assert.equal(emptySection.url, undefined);

  const validSection = validateEntryInput({ kind: 'section', title: 'swq', url: '', columnId: 'JAY' });
  assert.deepEqual(validSection, {});
});

test('filterEntries matches link title/url/domain and folder/section titles', () => {
  const sample: VaultEntry[] = [
    { id: '1', kind: 'link', columnId: 'CRE', parentId: null, title: 'Canva', url: 'https://canva.com', clicks: 0, createdAt: 1 },
    { id: '2', kind: 'folder', columnId: 'JAY', parentId: null, title: 'Design Folder', createdAt: 2 },
    { id: '3', kind: 'section', columnId: 'OTHER', parentId: null, title: 'swq', isOpen: false, createdAt: 3 },
  ];
  assert.equal(filterEntries(sample, '').length, 3);
  assert.deepEqual(filterEntries(sample, 'swq').map((e) => e.id), ['3']);
  assert.deepEqual(filterEntries(sample, 'canva.com').map((e) => e.id), ['1']);
});

test('moveEntryInScope reorders siblings only within matching column and parentId', () => {
  const items: VaultEntry[] = [
    { id: 'a1', kind: 'link', columnId: 'CRE', parentId: null, title: 'A1', url: 'https://a1.com', clicks: 0, createdAt: 1 },
    { id: 's1', kind: 'link', columnId: 'CRE', parentId: 'sec-1', title: 'Nested', url: 'https://n.com', clicks: 0, createdAt: 2 },
    { id: 'a2', kind: 'link', columnId: 'CRE', parentId: null, title: 'A2', url: 'https://a2.com', clicks: 0, createdAt: 3 },
  ];

  const movedUp = moveEntryInScope(items, 'a2', 'up');
  assert.deepEqual(
    movedUp.filter((i) => i.parentId === null).map((i) => i.id),
    ['a2', 'a1']
  );
});

test('reorderEntryOntoTarget swaps siblings and prevents nesting a folder into its own descendant', () => {
  const items: VaultEntry[] = [
    { id: 'f1', kind: 'folder', columnId: 'CRE', parentId: null, title: 'Folder 1', createdAt: 1 },
    { id: 'l1', kind: 'link', columnId: 'CRE', parentId: 'f1', title: 'Inside', url: 'https://in.com', clicks: 0, createdAt: 2 },
    { id: 'l2', kind: 'link', columnId: 'JAY', parentId: null, title: 'Outside', url: 'https://out.com', clicks: 0, createdAt: 3 },
  ];

  // Cannot drop f1 onto its own child l1
  const blocked = reorderEntryOntoTarget(items, 'f1', 'l1');
  assert.equal(blocked.find((e) => e.id === 'f1')?.parentId, null);

  // Moving l2 onto l1 moves it inside f1
  const movedInto = reorderEntryOntoTarget(items, 'l2', 'l1');
  assert.equal(movedInto.find((e) => e.id === 'l2')?.parentId, 'f1');
  assert.equal(movedInto.find((e) => e.id === 'l2')?.columnId, 'CRE');
});

test('deleteEntryCascade removes folder/section and all nested descendants', () => {
  const items: VaultEntry[] = [
    { id: 'f1', kind: 'folder', columnId: 'CRE', parentId: null, title: 'Folder', createdAt: 1 },
    { id: 's1', kind: 'section', columnId: 'CRE', parentId: 'f1', title: 'swq', isOpen: true, createdAt: 2 },
    { id: 'l1', kind: 'link', columnId: 'CRE', parentId: 's1', title: 'Deep Link', url: 'https://deep.com', clicks: 0, createdAt: 3 },
    { id: 'l2', kind: 'link', columnId: 'JAY', parentId: null, title: 'Keep', url: 'https://keep.com', clicks: 0, createdAt: 4 },
  ];
  assert.equal(countDescendantLinks(items, 'f1'), 1);
  const remaining = deleteEntryCascade(items, 'f1');
  assert.deepEqual(remaining.map((e) => e.id), ['l2']);
});

test('sanitizeEntries migrates v1 link objects without kind field and parseImportedBackup supports v1 and v2', () => {
  const migrated = sanitizeEntries([
    { id: 'old-1', columnId: 'CRE', title: 'Legacy', url: 'example.com', clicks: 2, createdAt: 100 },
  ]);
  assert.equal(migrated.length, 1);
  assert.equal(migrated[0].kind, 'link');
  assert.equal(migrated[0].parentId, null);

  const v2 = parseImportedBackup(
    JSON.stringify({
      columns: [{ id: 'CRE', label: 'CREATIVE' }],
      entries: [
        { id: 'sec-1', kind: 'section', columnId: 'CRE', title: 'swq', isOpen: false },
        { id: 'lnk-1', kind: 'link', columnId: 'CRE', parentId: 'sec-1', title: 'Sub', url: 'sub.com' },
      ],
    })
  );
  assert.equal(v2.entries.length, 2);
  assert.equal(v2.entries[0].kind, 'section');
  assert.equal(v2.entries[1].parentId, 'sec-1');

  const moved = moveEntryToScope(v2.entries, 'lnk-1', 'JAY', null);
  assert.equal(moved.find((e) => e.id === 'lnk-1')?.columnId, 'JAY');
  assert.equal(moved.find((e) => e.id === 'lnk-1')?.parentId, null);
});

test('Firestore payload mapping enforces blueprint constraints and sortOrder round-trips cleanly', () => {
  assert.equal(sanitizeEntryId('valid_id-123'), 'valid_id-123');
  assert.equal(sanitizeEntryId('../bad id/!'), '---bad-id--');

  const entries: VaultEntry[] = [
    {
      id: 'sec-1',
      kind: 'section',
      columnId: 'CRE',
      parentId: null,
      title: 'swq',
      isOpen: false,
      createdAt: 200,
    },
    {
      id: 'lnk-1',
      kind: 'link',
      columnId: 'CRE',
      parentId: 'sec-1',
      title: 'A'.repeat(120),
      url: 'example.com/path',
      clicks: 4,
      createdAt: 100,
    },
  ];

  const indexed = withReindexedSortOrder(entries);
  const payload = toFirestoreEntryCreatePayload(indexed[1], 'user-1', 'SERVER_TS');
  assert.equal(payload.ownerId, 'user-1');
  assert.equal(payload.isPublic, true);
  assert.equal(payload.title.length, 80);
  assert.equal(payload.url, 'https://example.com/path');
  assert.equal(payload.parentId, 'sec-1');
  assert.equal(payload.sortOrder, 1);

  const hydrated = fromFirestoreEntryDoc('lnk-1', { ...payload, createdAt: 100 });
  assert.ok(hydrated);
  assert.equal(hydrated.id, 'lnk-1');
  assert.equal(hydrated.parentId, 'sec-1');
  assert.equal(hydrated.sortOrder, 1);

  const sorted = sortEntriesByOrder([indexed[1], indexed[0]]);
  assert.deepEqual(sorted.map((e) => e.id), ['sec-1', 'lnk-1']);

  const colPayload = toFirestoreColumnPayload(
    [{ id: 'CRE', label: 'A'.repeat(40) }, { id: 'JAY', label: 'JAY' }, { id: 'OTHER', label: 'OTHER' }],
    'user-1',
    'SERVER_TS'
  );
  assert.equal(colPayload.creLabel.length, 24);
  assert.equal(colPayload.ownerId, 'user-1');
  assert.equal(colPayload.isPublic, true);

  assert.equal(isAuthorizedEditorEmail('m-10249244@moe-dl.edu.my'), true);
  assert.equal(isAuthorizedEditorEmail('M-10249244@MOE-DL.EDU.MY '), true);
  assert.equal(isAuthorizedEditorEmail('visitor@example.com'), false);
  assert.equal(isAuthorizedEditorEmail(null), false);
});

