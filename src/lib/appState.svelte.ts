import { browser } from '$app/environment';
import { STORAGE_KEY } from './checklists/constants';
import { createEmptyAppState, normalizeAppState } from './checklists/app-state';
import type { AppState } from './checklists/types';
import { SvelteDate, SvelteMap } from 'svelte/reactivity';

const DATABASE_NAME = 'recurring-checklists';
const DATABASE_VERSION = 1;
const STORE_NAME = 'key-value';
const TAB_CHANNEL_NAME = 'recurring-checklists-tabs';
const TAB_HEARTBEAT_MS = 3000;
const TAB_STALE_MS = 10000;

type TabPresenceMessage = {
	type: 'hello' | 'presence' | 'goodbye';
	tabId: string;
};

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
	updatedAt: new SvelteDate(0).toISOString(),
	hasOtherOpenTabs: false
});

let initializing: Promise<void> | null = null;
let persistQueue = Promise.resolve();
let tabPresenceStarted = false;

export async function initializeAppState(): Promise<void> {
	if (!browser) return;
	initializing ??= initializeState();
	await initializing;
}

async function initializeState(): Promise<void> {
	startTabPresenceDetection();

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

function startTabPresenceDetection(): void {
	if (tabPresenceStarted || typeof BroadcastChannel === 'undefined') return;
	tabPresenceStarted = true;

	const tabId = crypto.randomUUID();
	const peers = new SvelteMap<string, number>();
	const channel = new BroadcastChannel(TAB_CHANNEL_NAME);

	const post = (type: TabPresenceMessage['type']): void => {
		channel.postMessage({ type, tabId } satisfies TabPresenceMessage);
	};

	const prunePeers = (): void => {
		const staleBefore = Date.now() - TAB_STALE_MS;
		for (const [peerTabId, lastSeenAt] of peers) {
			if (lastSeenAt < staleBefore) peers.delete(peerTabId);
		}

		appStateStorage.hasOtherOpenTabs = peers.size > 0;
	};

	const rememberPeer = (peerTabId: string): void => {
		peers.set(peerTabId, Date.now());
		appStateStorage.hasOtherOpenTabs = true;
	};

	channel.onmessage = (event: MessageEvent<unknown>) => {
		const message = event.data;
		if (!isTabPresenceMessage(message) || message.tabId === tabId) return;

		if (message.type === 'goodbye') {
			peers.delete(message.tabId);
			appStateStorage.hasOtherOpenTabs = peers.size > 0;
			return;
		}

		rememberPeer(message.tabId);
		if (message.type === 'hello') post('presence');
	};

	post('hello');
	const heartbeat = window.setInterval(() => post('presence'), TAB_HEARTBEAT_MS);
	const prune = window.setInterval(prunePeers, TAB_HEARTBEAT_MS);

	window.addEventListener('pagehide', (event) => {
		if (event.persisted) return;

		post('goodbye');
		window.clearInterval(heartbeat);
		window.clearInterval(prune);
		channel.close();
	});
}

function isTabPresenceMessage(value: unknown): value is TabPresenceMessage {
	return (
		typeof value === 'object' &&
		value !== null &&
		'type' in value &&
		(value.type === 'hello' || value.type === 'presence' || value.type === 'goodbye') &&
		'tabId' in value &&
		typeof value.tabId === 'string'
	);
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
