// Browser keyring. Each local identity is one IndexedDB record:
//   {id, name, kind: 'human', privateKey, token, createdAt}
// The private key is a non-extractable WebCrypto CryptoKey: page script can
// sign with it, but no script can read or export its bytes, and it never
// leaves this browser profile. IndexedDB stores the CryptoKey object itself.
// `token` is the hub session token returned once at registration (null until
// then). The selected identity is remembered in localStorage.
import { generateIdentity } from '/lib/koinos/crypto.mjs';
import { cleanName } from './format.mjs';

const DB_NAME = 'exofab-keyring';
const DB_VERSION = 1;
const STORE = 'identities';
const CURRENT = 'exofab.current-identity';

// Dispatched on window with detail {id} whenever the current identity changes.
export const IDENTITY_EVENT = 'exofab:identity';

let opening = null;
let fallbackCurrent = null; // used only when localStorage is unavailable

function db() {
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) {
        reject(new Error('This browser has no IndexedDB, so it cannot keep keys.'));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      request.onsuccess = () => {
        const conn = request.result;
        // Let a newer version of this page upgrade the database.
        conn.onversionchange = () => {
          conn.close();
          opening = null;
        };
        resolve(conn);
      };
      request.onerror = () => reject(request.error ?? new Error('Could not open the keyring'));
      request.onblocked = () => reject(new Error('The keyring is open in another tab with an older version. Close that tab and reload.'));
    });
    opening.catch(() => {
      opening = null;
    });
  }
  return opening;
}

// Runs `work(store, out)` in one transaction and resolves with out.value once
// the transaction commits, so a resolved write is durable.
async function transact(mode, work) {
  const conn = await db();
  return new Promise((resolve, reject) => {
    const tx = conn.transaction(STORE, mode);
    const out = { value: undefined, reason: null };
    tx.oncomplete = () => resolve(out.value);
    tx.onabort = () => reject(tx.error ?? new Error(out.reason ?? 'Keyring transaction aborted'));
    work(tx.objectStore(STORE), out, tx);
  });
}

const summary = (r) => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  createdAt: r.createdAt,
  registered: typeof r.token === 'string' && r.token !== '',
});

// Public facts only: {id, name, kind, createdAt, registered}, oldest first.
// Use getIdentity for the private key and token.
export async function listIdentities() {
  const all = await transact('readonly', (store, out) => {
    const request = store.getAll();
    request.onsuccess = () => {
      out.value = request.result;
    };
  });
  return (all ?? []).map(summary).sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}

// The full record, including privateKey and token, or null.
export async function getIdentity(id) {
  if (typeof id !== 'string' || id === '') return null;
  const record = await transact('readonly', (store, out) => {
    const request = store.get(id);
    request.onsuccess = () => {
      out.value = request.result;
    };
  });
  return record ?? null;
}

export async function createIdentity(name) {
  const clean = cleanName(name);
  let generated;
  try {
    generated = await generateIdentity({ extractable: false });
  } catch (error) {
    if (error?.name === 'NotSupportedError') throw new Error('This browser does not support Ed25519 keys in WebCrypto. Use a current browser.');
    throw error;
  }
  const { id, privateKey } = generated;
  if (privateKey.extractable !== false) throw new Error('Refusing to store an extractable private key');
  const record = { id, name: clean, kind: 'human', privateKey, token: null, createdAt: new Date().toISOString() };
  await transact('readwrite', (store) => {
    store.add(record);
  });
  return record;
}

export async function saveToken(id, token) {
  if (typeof token !== 'string' || token === '') throw new TypeError('token must be a non-empty string');
  await transact('readwrite', (store, out, tx) => {
    const request = store.get(id);
    request.onsuccess = () => {
      if (!request.result) {
        out.reason = 'No identity with that id in this browser';
        tx.abort();
        return;
      }
      store.put({ ...request.result, token });
    };
  });
}

// Changes the local name of an identity (for example, after the hub profile's
// display name changes). The key and token are kept.
export async function renameIdentity(id, name) {
  const clean = cleanName(name);
  await transact('readwrite', (store, out, tx) => {
    const request = store.get(id);
    request.onsuccess = () => {
      if (!request.result) {
        out.reason = 'No identity with that id in this browser';
        tx.abort();
        return;
      }
      store.put({ ...request.result, name: clean });
    };
  });
}

// Deletes the identity and its private key from this browser. There is no
// recovery: the key cannot be exported, so its records can no longer be
// extended by this identity.
export async function removeIdentity(id) {
  await transact('readwrite', (store) => {
    store.delete(id);
  });
  if (currentId() === id) remember(null);
}

function remember(id) {
  try {
    if (id) localStorage.setItem(CURRENT, id);
    else localStorage.removeItem(CURRENT);
  } catch {
    // Storage can be unavailable (private windows, blocked site data); the
    // selection then lasts only for this page.
    fallbackCurrent = id;
  }
  globalThis.dispatchEvent?.(new CustomEvent(IDENTITY_EVENT, { detail: { id } }));
}

export function currentId() {
  try {
    return localStorage.getItem(CURRENT) || null;
  } catch {
    return fallbackCurrent;
  }
}

// The selected identity's full record, or null. A selection whose identity no
// longer exists is cleared.
export async function current() {
  const id = currentId();
  if (!id) return null;
  const record = await getIdentity(id);
  if (!record) remember(null);
  return record;
}

// Selects an identity that exists in this browser, or clears the selection
// with null. Resolves with the selected record (or null).
export async function setCurrent(id) {
  if (id === null) {
    remember(null);
    return null;
  }
  const record = await getIdentity(id);
  if (!record) throw new Error('No identity with that id in this browser');
  remember(id);
  return record;
}
