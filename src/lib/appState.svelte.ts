import { browser } from '$app/environment';
import { STORAGE_KEY } from './checklists/constants';
import { createEmptyAppState, normalizeAppState } from './checklists/app-state';
import type { AppState } from './checklists/types';
import { SvelteDate } from 'svelte/reactivity';

const DATABASE_NAME = 'recurring-checklists';
const DATABASE_VERSION = 1;
const STORE_NAME = 'key-value';

type StoredAppState = {
	state: AppState;
	updatedAt: string;
};

type StoredAppStateEnvelope = {
	version: 1;
	updatedAt: string;
	appState: AppState;
};

export const appState = $state<AppState>(createEmptyAppState());
export const appStateStorage = $state({
	initialized: false,
	updatedAt: new SvelteDate(0).toISOString()
});

let initializing: Promise<void> | null = null;
let persistQueue = Promise.resolve();

export async function initializeAppState(): Promise<void> {
	if (!browser) return;
	initializing ??= initializeState();
	await initializing;
}

async function initializeState(): Promise<void> {
	const stored = await loadStoredAppState();
	replaceAppState(stored.state);
	appStateStorage.updatedAt = stored.updatedAt;

	// Start Auto Persist
	$effect.root(() => {
		let ready = false;

		$effect(() => {
			const data = JSON.stringify(appState);
			if (!ready) {
				ready = true;
				return;
			}

			const updatedAt = new Date().toISOString();
			appStateStorage.updatedAt = updatedAt;
			queuePersist(data, updatedAt);
		});
	});

	appStateStorage.initialized = true;

	window.addEventListener('pagehide', () => {
		queuePersist(JSON.stringify(appState), appStateStorage.updatedAt);
	});
}

async function loadStoredAppState(): Promise<StoredAppState> {
	const stored = await getStoredValue(STORAGE_KEY);
	if (stored) {
		try {
			const parsed: unknown = JSON.parse(stored);
			const envelope = normalizeStoredAppStateEnvelope(parsed);
			if (envelope) return envelope;

			const legacyState = normalizeAppState(parsed);
			if (legacyState) {
				const updatedAt = new Date().toISOString();
				await setStoredAppState(legacyState, updatedAt);
				return { state: legacyState, updatedAt };
			}
		} catch {
			return { state: createEmptyAppState(), updatedAt: new Date(0).toISOString() };
		}
	}

	const emptyState = createEmptyAppState();
	const updatedAt = new Date(0).toISOString();
	await setStoredAppState(emptyState, updatedAt);
	return { state: emptyState, updatedAt };
}

function replaceAppState(nextState: AppState): void {
	appState.version = nextState.version;
	appState.checklists = nextState.checklists;
	appState.completions = nextState.completions;
}

function queuePersist(snapshot: string, updatedAt: string): void {
	persistQueue = persistQueue
		.catch(() => undefined)
		.then(() => setStoredValue(STORAGE_KEY, serializeStoredAppState(snapshot, updatedAt)));
}

async function setStoredAppState(state: AppState, updatedAt: string): Promise<void> {
	await setStoredValue(STORAGE_KEY, serializeStoredAppState(JSON.stringify(state), updatedAt));
}

function serializeStoredAppState(snapshot: string, updatedAt: string): string {
	return JSON.stringify({
		version: 1,
		updatedAt,
		appState: JSON.parse(snapshot)
	} satisfies StoredAppStateEnvelope);
}

function normalizeStoredAppStateEnvelope(value: unknown): StoredAppState | null {
	if (
		typeof value !== 'object' ||
		value === null ||
		!('version' in value) ||
		value.version !== 1 ||
		!('updatedAt' in value) ||
		typeof value.updatedAt !== 'string' ||
		Number.isNaN(Date.parse(value.updatedAt)) ||
		!('appState' in value)
	) {
		return null;
	}

	const state = normalizeAppState(value.appState);
	if (!state) return null;

	return {
		state,
		updatedAt: new Date(value.updatedAt).toISOString()
	};
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
