/**
 * IndexedDB-backed store for CLAUDE.md routing rules.
 *
 * Why IndexedDB: each route owns a FileSystemFileHandle, which is structured-
 * cloneable but not JSON-serializable. chrome.storage would lose the underlying
 * OS file binding on round-trip; IndexedDB preserves it across sessions.
 */

import type { ClaudeMdRoute } from './types';

const DB_NAME = 'ccc-handles';
const DB_VERSION = 2;
const STORE_KV = 'kv';
const STORE_ROUTES = 'routes';
const LEGACY_KEY = 'claudeMdHandle';
const MCP_DIR_KEY = 'mcpContextsDir';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      if (event.oldVersion < 1) {
        db.createObjectStore(STORE_KV);
      }
      if (event.oldVersion < 2) {
        // routes is keyed by route.id; we use out-of-line keys via keyPath.
        db.createObjectStore(STORE_ROUTES, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);
        const req = fn(store);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

/** Read every saved route. Order is deterministic by createdAt ASC. */
export async function listRoutes(): Promise<ClaudeMdRoute[]> {
  await migrateLegacyHandle();
  const all = await tx<ClaudeMdRoute[]>(STORE_ROUTES, 'readonly', (s) => s.getAll());
  const migrated = await Promise.all(all.map(migrateLegacySingleHandle));
  return migrated.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Insert or replace a route by id. */
export async function saveRoute(route: ClaudeMdRoute): Promise<void> {
  await tx(STORE_ROUTES, 'readwrite', (s) => s.put(route));
}

/** Look up a single route by id. */
export async function getRoute(id: string): Promise<ClaudeMdRoute | undefined> {
  const route = await tx<ClaudeMdRoute | undefined>(
    STORE_ROUTES,
    'readonly',
    (s) => s.get(id)
  );
  if (!route) return undefined;
  return migrateLegacySingleHandle(route);
}

/**
 * Pure normalization of a route's handle shape. A route written before v0.9.0
 * carries a single `handle: FileSystemFileHandle`; v0.9.0+ carry
 * `handles: FileSystemFileHandle[]`. Returns the route in the new shape plus
 * whether anything changed, so the caller can persist only when needed. No
 * I/O — extracted from the lazy migration so the branching is unit-testable.
 *
 * - already migrated, no stray legacy field → unchanged
 * - already migrated but a stray `handle` lingered → strip it (changed)
 * - legacy single handle → wrap into `handles: [handle]`, strip `handle`
 * - neither field (defensive) → empty `handles: []`; the caller surfaces an
 *   actionable error. Not flagged changed — there's nothing worth persisting.
 */
export function normalizeRouteHandles(
  route: ClaudeMdRoute
): { route: ClaudeMdRoute; changed: boolean } {
  const legacy = route as ClaudeMdRoute & { handle?: FileSystemFileHandle };
  if (Array.isArray(route.handles) && route.handles.length > 0) {
    if (legacy.handle) {
      const next = { ...route } as ClaudeMdRoute & { handle?: FileSystemFileHandle };
      delete next.handle;
      return { route: next, changed: true };
    }
    return { route, changed: false };
  }
  if (legacy.handle) {
    const next = { ...route, handles: [legacy.handle] } as ClaudeMdRoute & {
      handle?: FileSystemFileHandle;
    };
    delete next.handle;
    return { route: next, changed: true };
  }
  return { route: { ...route, handles: [] }, changed: false };
}

/**
 * Lazy in-place migration: normalize a route's handle shape on first read and
 * persist the new shape once. After this runs once per route, no further
 * migration cost.
 */
async function migrateLegacySingleHandle(route: ClaudeMdRoute): Promise<ClaudeMdRoute> {
  const { route: normalized, changed } = normalizeRouteHandles(route);
  if (changed) await saveRoute(normalized);
  return normalized;
}

/** Delete a route by id. */
export async function deleteRoute(id: string): Promise<void> {
  await tx(STORE_ROUTES, 'readwrite', (s) => s.delete(id));
}

/**
 * Persist the directory handle for the MCP contexts store. Captures in
 * `mcp-store` output mode are written here as standalone `<slug>.md` files,
 * which the companion MCP server reads to expose them to Claude Code.
 */
export async function saveMcpDir(handle: FileSystemDirectoryHandle): Promise<void> {
  await tx(STORE_KV, 'readwrite', (s) => s.put(handle, MCP_DIR_KEY));
}

/** Read the saved MCP contexts directory handle, if any. */
export async function getMcpDir(): Promise<FileSystemDirectoryHandle | undefined> {
  return tx<FileSystemDirectoryHandle | undefined>(
    STORE_KV,
    'readonly',
    (s) => s.get(MCP_DIR_KEY)
  );
}

/** Forget the linked MCP contexts directory. */
export async function clearMcpDir(): Promise<void> {
  await tx(STORE_KV, 'readwrite', (s) => s.delete(MCP_DIR_KEY));
}

/**
 * One-time migration from v0.2.0's single-handle schema. If a legacy
 * `claudeMdHandle` value exists in the kv store and no routes yet exist,
 * convert it to a single default route.
 */
async function migrateLegacyHandle(): Promise<void> {
  const legacy = await tx<FileSystemFileHandle | undefined>(
    STORE_KV,
    'readonly',
    (s) => s.get(LEGACY_KEY)
  );
  if (!legacy) return;

  const existing = await tx<ClaudeMdRoute[]>(STORE_ROUTES, 'readonly', (s) => s.getAll());
  if (existing.length > 0) {
    // Routes already populated — drop the legacy key without further action.
    await tx(STORE_KV, 'readwrite', (s) => s.delete(LEGACY_KEY));
    return;
  }

  const migrated: ClaudeMdRoute = {
    id: crypto.randomUUID(),
    label: legacy.name || 'CLAUDE.md',
    pattern: '',
    isDefault: true,
    createdAt: new Date().toISOString(),
    handles: [legacy],
  };
  await tx(STORE_ROUTES, 'readwrite', (s) => s.put(migrated));
  await tx(STORE_KV, 'readwrite', (s) => s.delete(LEGACY_KEY));
}
