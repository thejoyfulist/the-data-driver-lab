/**
 * Where the "AI — your own key" settings live: this browser only.
 *
 * Default: sessionStorage (gone when the tab closes). "Remember on this
 * device" moves the same record to localStorage; turning it off or "Forget
 * key" removes it from both. The record never leaves the browser: nothing in
 * the Lab sends it to The Data Driver.
 */

export const STORAGE_KEY = "tdd.lab.ai-byok.v1";

function safeGet(storage) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    return value && typeof value === "object" ? value : null;
  } catch (error) {
    // Storage blocked (privacy mode) or a corrupt record: start empty.
    console.warn("AI settings could not be read", error instanceof Error ? error.name : error);
    return null;
  }
}

function safeRemove(storage) {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn("AI settings could not be removed", error instanceof Error ? error.name : error);
  }
}

/**
 * @param {{ session?: Storage | null, local?: Storage | null }} stores
 * @returns {{ provider?: string, model?: string, baseURL?: string, apiKey?: string, remember: boolean }}
 */
export function loadSettings({ session, local }) {
  const remembered = safeGet(local);
  if (remembered) return { ...pick(remembered), remember: true };
  const current = safeGet(session);
  return { ...(current ? pick(current) : {}), remember: false };
}

function pick(value) {
  const out = {};
  for (const key of ["provider", "model", "baseURL", "apiKey"]) {
    if (typeof value[key] === "string") out[key] = value[key];
  }
  return out;
}

/**
 * Save to one store and clear the other, so a key is never left behind in
 * localStorage after "remember" is turned off.
 * @returns {boolean} false when the browser refused to store it
 */
export function saveSettings({ session, local }, settings, remember) {
  const target = remember ? local : session;
  const other = remember ? session : local;
  safeRemove(other);
  try {
    target?.setItem(STORAGE_KEY, JSON.stringify(pick(settings ?? {})));
    return Boolean(target);
  } catch (error) {
    console.warn("AI settings could not be saved", error instanceof Error ? error.name : error);
    return false;
  }
}

/** Remove the key (and the rest of the record) from both stores. */
export function forgetSettings({ session, local }) {
  safeRemove(session);
  safeRemove(local);
}

/** Browser stores, or null where storage access throws. */
export function browserStores() {
  const read = (name) => {
    try {
      return typeof window === "undefined" ? null : window[name];
    } catch (error) {
      // Some privacy modes throw on access: the key then lives only in memory.
      console.warn(`${name} unavailable`, error instanceof Error ? error.name : error);
      return null;
    }
  };
  return { session: read("sessionStorage"), local: read("localStorage") };
}
