import { browser } from '$app/environment';
import { STORAGE_KEY } from './checklists/constants';
import { createEmptyAppState, loadAppState, normalizeAppState } from './checklists/app-state';
import type { AppState } from './checklists/types';
import {
	authorizeDrive,
	downloadDriveAppState,
	hasDriveToken,
	restoreStoredDriveToken,
	uploadDriveAppState
} from './google-drive';
import { SvelteDate } from 'svelte/reactivity';

const DATABASE_NAME = 'recurring-checklists';
const DATABASE_VERSION = 1;
const STORE_NAME = 'key-value';
const DRIVE_UPLOAD_DEBOUNCE_MS = 15_000;

type StoredAppState = {
	state: AppState;
	updatedAt: string;
};

type StoredAppStateEnvelope = {
	version: 1;
	updatedAt: string;
	appState: AppState;
};

type DriveSyncStatus =
	| 'disabled'
	| 'signed-out'
	| 'connected'
	| 'syncing'
	| 'reauthorize'
	| 'error';

export const appState = $state<AppState>(createEmptyAppState());
export const appStateStorage = $state({
	initialized: false,
	updatedAt: new SvelteDate(0).toISOString(),
	drive: {
		enabled: false,
		status: 'disabled' as DriveSyncStatus,
		message: ''
	}
});

let initializing: Promise<void> | null = null;
let persistQueue = Promise.resolve();
let driveUploadTimer: number | undefined;
let suppressNextPersist = false;

export async function initializeAppState(): Promise<void> {
	if (!browser) return;
	initializing ??= initializeState();
	await initializing;
}

async function initializeState(): Promise<void> {
	const stored = await loadStoredAppState();
	const hasStoredDriveToken = await restoreStoredDriveToken();
	replaceAppState(stored.state);
	appStateStorage.updatedAt = stored.updatedAt;
	appStateStorage.drive.enabled = hasStoredDriveToken;
	appStateStorage.drive.status = hasStoredDriveToken ? 'connected' : 'signed-out';
	appStateStorage.drive.message = hasStoredDriveToken ? 'Google Drive sync is connected.' : '';

	// Start Auto Persist
	$effect.root(() => {
		let ready = false;

		$effect(() => {
			const data = JSON.stringify(appState);
			if (!ready) {
				ready = true;
				return;
			}

			if (suppressNextPersist) {
				suppressNextPersist = false;
				return;
			}

			const updatedAt = new Date().toISOString();
			appStateStorage.updatedAt = updatedAt;
			queuePersist(data, updatedAt);
			scheduleDriveUpload(data, updatedAt);
		});
	});

	appStateStorage.initialized = true;

	window.addEventListener('pagehide', () => {
		if (driveUploadTimer !== undefined) {
			window.clearTimeout(driveUploadTimer);
			driveUploadTimer = undefined;
		}

		queuePersist(JSON.stringify(appState), appStateStorage.updatedAt);
	});
}

export async function connectDriveSync(clientId: string): Promise<void> {
	if (!browser) return;

	try {
		appStateStorage.drive.status = 'syncing';
		appStateStorage.drive.message = 'Connecting to Google Drive...';
		await authorizeDrive(clientId);
		appStateStorage.drive.enabled = true;
		appStateStorage.drive.status = 'connected';
		appStateStorage.drive.message = 'Google Drive sync is connected.';
	} catch (error) {
		setDriveError(error);
		throw error;
	}
}

export async function syncDriveNow(clientId: string): Promise<void> {
	if (!browser) return;

	try {
		appStateStorage.drive.status = 'syncing';
		appStateStorage.drive.message = 'Syncing with Google Drive...';

		if (!hasDriveToken()) {
			await authorizeDrive(clientId);
		}

		appStateStorage.drive.enabled = true;
		const remote = await downloadDriveAppState();
		const localUpdatedAt = appStateStorage.updatedAt;

		if (!remote) {
			await uploadCurrentState(localUpdatedAt);
			appStateStorage.drive.status = 'connected';
			appStateStorage.drive.message = 'Uploaded local state to Google Drive.';
			return;
		}

		if (Date.parse(remote.updatedAt) > Date.parse(localUpdatedAt)) {
			suppressNextPersist = true;
			replaceAppState(remote.state);
			appStateStorage.updatedAt = remote.updatedAt;
			queuePersist(JSON.stringify(remote.state), remote.updatedAt);
			appStateStorage.drive.status = 'connected';
			appStateStorage.drive.message = 'Downloaded newer Google Drive state.';
			return;
		}

		await uploadCurrentState(localUpdatedAt);
		appStateStorage.drive.status = 'connected';
		appStateStorage.drive.message = 'Google Drive is up to date.';
	} catch (error) {
		setDriveError(error);
		throw error;
	}
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

	const hasLegacyState = localStorage.getItem(STORAGE_KEY) !== null;
	const migrated = loadAppState(localStorage);
	const updatedAt = hasLegacyState ? new Date().toISOString() : new Date(0).toISOString();
	await setStoredAppState(migrated, updatedAt);
	return { state: migrated, updatedAt };
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

function scheduleDriveUpload(snapshot: string, updatedAt: string): void {
	if (!appStateStorage.drive.enabled || appStateStorage.drive.status === 'reauthorize') return;
	if (driveUploadTimer !== undefined) window.clearTimeout(driveUploadTimer);

	driveUploadTimer = window.setTimeout(() => {
		driveUploadTimer = undefined;
		void uploadSnapshot(snapshot, updatedAt);
	}, DRIVE_UPLOAD_DEBOUNCE_MS);
}

async function uploadCurrentState(updatedAt: string): Promise<void> {
	await uploadDriveAppState(JSON.parse(JSON.stringify(appState)) as AppState, updatedAt);
}

async function uploadSnapshot(snapshot: string, updatedAt: string): Promise<void> {
	try {
		appStateStorage.drive.status = 'syncing';
		const state = normalizeAppState(JSON.parse(snapshot));
		if (!state) throw new Error('Local app state is not valid.');

		await uploadDriveAppState(state, updatedAt);
		appStateStorage.drive.status = 'connected';
		appStateStorage.drive.message = `Saved to Google Drive at ${new Date(updatedAt).toLocaleTimeString()}.`;
	} catch (error) {
		setDriveError(error);
	}
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

function setDriveError(error: unknown): void {
	const message = error instanceof Error ? error.message : 'Google Drive sync failed.';
	appStateStorage.drive.status = isAuthorizationError(message) ? 'reauthorize' : 'error';
	appStateStorage.drive.message = message;
}

function isAuthorizationError(message: string): boolean {
	return /401|auth|credential|token|authorize/i.test(message);
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
