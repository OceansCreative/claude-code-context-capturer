/**
 * IndexedDB-backed store for the user-linked CLAUDE.md FileSystemFileHandle.
 *
 * Why IndexedDB and not chrome.storage: the File System Access API returns a
 * FileSystemFileHandle, which is structured-cloneable but not JSON-serializable.
 * chrome.storage serializes everything as JSON, so the handle would be lost.
 * IndexedDB preserves the handle and its underlying OS-level file binding
 * across browser restarts.
 */

const DB_NAME = 'ccc-handles';
const STORE = 'kv';
const KEY_HANDLE = 'claudeMdHandle';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | Promise<T>
): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const result = fn(store);
    if (result instanceof IDBRequest) {
      result.onsuccess = () => resolve(result.result);
      result.onerror = () => reject(result.error);
    } else {
      result.then(resolve, reject);
    }
  });
}

/** Persist the file handle the user just picked. */
export async function saveClaudeMdHandle(handle: FileSystemFileHandle): Promise<void> {
  await withStore('readwrite', (store) => store.put(handle, KEY_HANDLE));
}

/** Read the previously saved handle, or undefined if none. */
export async function loadClaudeMdHandle(): Promise<FileSystemFileHandle | undefined> {
  return withStore<FileSystemFileHandle | undefined>('readonly', (store) =>
    store.get(KEY_HANDLE)
  );
}

/** Forget the linked file. */
export async function clearClaudeMdHandle(): Promise<void> {
  await withStore('readwrite', (store) => store.delete(KEY_HANDLE));
}
