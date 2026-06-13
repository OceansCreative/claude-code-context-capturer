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
 * Lazy in-place migration: a route written before v0.9.0 has `handle:
 * FileSystemFileHandle` rather than `handles: FileSystemFileHandle[]`. On
 * first read we wrap the single handle into an array and persist the new
 * shape. After this runs once per route, no further migration cost.
 */
async function migrateLegacySingleHandle(route: ClaudeMdRoute): Promise<ClaudeMdRoute> {
  const legacy = route as ClaudeMdRoute & { handle?: FileSystemFileHandle };
  if (Array.isArray(route.handles) && route.handles.length > 0) {
    // Already migrated; just clean up any stray legacy field if it lingered.
    if (legacy.handle) {
      delete legacy.handle;
      await saveRoute(route);
    }
    return route;
  }
  if (legacy.handle) {
    const next: ClaudeMdRoute = {
      ...route,
      handles: [legacy.handle],
    };
    delete (next as { handle?: FileSystemFileHandle }).handle;
    await saveRoute(next);
    return next;
  }
  // Defensive: route with neither field — leave empty handles[], caller
  // surfaces an actionable error.
  return { ...route, handles: [] };
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
