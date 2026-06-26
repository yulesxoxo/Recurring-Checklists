import { browser } from '$app/environment';
import { STORAGE_KEY } from './checklists/constants';
import { createEmptyAppState, loadAppState, normalizeAppState } from './checklists/app-state';
import type { AppState } from './checklists/types';

const DATABASE_NAME = 'recurring-checklists';
const DATABASE_VERSION = 1;
const STORE_NAME = 'key-value';
const PERSIST_DEBOUNCE_MS = 10_000;

export const appState = $state<AppState>(createEmptyAppState());
export const appStateStorage = $state({
	initialized: false
});

let initializing: Promise<void> | null = null;
let persistQueue = Promise.resolve();
let persistTimer: number | undefined;

export async function initializeAppState(): Promise<void> {
	if (!browser) return;
	initializing ??= initializeState();
	await initializing;
}

async function initializeState(): Promise<void> {
	replaceAppState(await loadStoredAppState());

	// Start Auto Persist
	$effect.root(() => {
		let ready = false;

		$effect(() => {
			const data = JSON.stringify(appState);
			if (!ready) {
				ready = true;
				return;
			}

			if (persistTimer !== undefined) window.clearTimeout(persistTimer);

			persistTimer = window.setTimeout(() => {
				persistTimer = undefined;
				queuePersist(data);
			}, PERSIST_DEBOUNCE_MS);
		});
	});

	appStateStorage.initialized = true;

	window.addEventListener('pagehide', () => {
		if (persistTimer !== undefined) {
			window.clearTimeout(persistTimer);
			persistTimer = undefined;
		}

		queuePersist(JSON.stringify(appState));
	});
}

async function loadStoredAppState(): Promise<AppState> {
	const stored = await getStoredValue(STORAGE_KEY);
	if (stored) {
		try {
			return normalizeAppState(JSON.parse(stored)) ?? createEmptyAppState();
		} catch {
			return createEmptyAppState();
		}
	}

	const migrated = loadAppState(localStorage);
	await setStoredValue(STORAGE_KEY, JSON.stringify(migrated));
	return migrated;
}

function replaceAppState(nextState: AppState): void {
	appState.version = nextState.version;
	appState.checklists = nextState.checklists;
	appState.completions = nextState.completions;
}

function queuePersist(snapshot: string): void {
	console.log('persisting');
	persistQueue = persistQueue
		.catch(() => undefined)
		.then(() => setStoredValue(STORAGE_KEY, snapshot));
}

async function getStoredValue(key: string): Promise<string | null> {
	const database = await openDatabase();

	return new Promise((resolve, reject) => {
		const transaction = database.transaction(STORE_NAME, 'readonly');
		const request = transaction.objectStore(STORE_NAME).get(key);

		request.onsuccess = () => resolve(typeof request.result === 'string' ? request.result : null);
		request.onerror = () => reject(request.error);
	});
}

async function setStoredValue(key: string, value: string): Promise<void> {
	const database = await openDatabase();

	await new Promise<void>((resolve, reject) => {
		const transaction = database.transaction(STORE_NAME, 'readwrite');
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error);
		transaction.objectStore(STORE_NAME).put(value, key);
	});
}

function openDatabase(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

		request.onupgradeneeded = () => {
			const database = request.result;
			if (!database.objectStoreNames.contains(STORE_NAME)) {
				database.createObjectStore(STORE_NAME);
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}
