import { browser } from '$app/environment';
import { normalizeAppState } from './checklists/app-state';
import type { AppState } from './checklists/types';

const GOOGLE_IDENTITY_SCRIPT = 'https://accounts.google.com/gsi/client';
const DRIVE_SCOPE =
	'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/drive.file';
const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const APP_STATE_FILENAME = 'recurring-checklists-app-state-v1.json';
const SHARED_TEMPLATES_FOLDER_NAME = 'checklist-yules-shared-templates';
const DRIVE_FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const DATABASE_NAME = 'recurring-checklists';
const DATABASE_VERSION = 1;
const STORE_NAME = 'key-value';
const TOKEN_STORAGE_KEY = 'google-drive-token-v1';
const TOKEN_EXPIRY_SKEW_MS = 60_000;

type TokenResponse = {
	access_token?: string;
	expires_in?: number;
	error?: string;
	error_description?: string;
};

type TokenClient = {
	requestAccessToken: (options?: { prompt?: string }) => void;
};

type GoogleIdentity = {
	accounts?: {
		oauth2?: {
			initTokenClient: (config: {
				client_id: string;
				scope: string;
				callback: (response: TokenResponse) => void;
			}) => TokenClient;
		};
	};
};

type DriveFile = {
	id: string;
	name: string;
	modifiedTime?: string;
	webViewLink?: string;
};

type DriveFileList = {
	files?: DriveFile[];
};

type DriveAppStatePayload = {
	version: 1;
	appSchemaVersion: AppState['version'];
	updatedAt: string;
	appState: AppState;
};

type StoredDriveToken = {
	version: 1;
	accessToken: string;
	expiresAt: string;
	scope: string;
};

export type DriveAppState = {
	state: AppState;
	updatedAt: string;
	fileId: string;
};

export type PublicDriveFileResult = {
	id: string;
	name: string;
	publicUrl: string;
	webViewLink: string;
};

let identityScriptPromise: Promise<void> | undefined;
let accessToken = '';
let accessTokenExpiresAt = 0;
let appStateFileId: string | undefined;
let sharedTemplatesFolderId: string | undefined;

export function hasDriveToken(): boolean {
	return accessToken.length > 0 && Date.now() < accessTokenExpiresAt - TOKEN_EXPIRY_SKEW_MS;
}

export async function restoreStoredDriveToken(): Promise<boolean> {
	if (!browser) return false;

	const stored = await getStoredValue(TOKEN_STORAGE_KEY);
	if (!stored) return false;

	try {
		const parsed: unknown = JSON.parse(stored);
		const token = normalizeStoredDriveToken(parsed);
		if (!token) {
			await removeStoredValue(TOKEN_STORAGE_KEY);
			return false;
		}

		accessToken = token.accessToken;
		accessTokenExpiresAt = Date.parse(token.expiresAt);
		return true;
	} catch {
		await removeStoredValue(TOKEN_STORAGE_KEY);
		return false;
	}
}

export async function authorizeDrive(clientId: string): Promise<void> {
	assertBrowser();
	assertClientId(clientId);
	await loadGoogleIdentityScript();

	await new Promise<void>((resolve, reject) => {
		const tokenClient = googleIdentity()?.accounts?.oauth2?.initTokenClient({
			client_id: clientId,
			scope: DRIVE_SCOPE,
			callback: (response) => {
				if (response.error) {
					reject(new Error(response.error_description || response.error));
					return;
				}

				if (!response.access_token) {
					reject(new Error('Google authorization did not return an access token.'));
					return;
				}

				accessToken = response.access_token;
				accessTokenExpiresAt = Date.now() + Math.max(1, response.expires_in ?? 3600) * 1000;
				void storeDriveToken();
				resolve();
			}
		});

		if (!tokenClient) {
			reject(new Error('Google Identity Services did not initialize.'));
			return;
		}

		tokenClient.requestAccessToken({ prompt: hasDriveToken() ? '' : 'consent' });
	});
}

export async function uploadDriveAppState(
	state: AppState,
	updatedAt: string
): Promise<DriveAppState> {
	assertAccessToken();
	const file = await ensureAppStateFile();
	const payload: DriveAppStatePayload = {
		version: 1,
		appSchemaVersion: state.version,
		updatedAt,
		appState: state
	};
	const savedFile = await updateJsonFile(file.id, payload, 'id,name,modifiedTime');

	return {
		state,
		updatedAt,
		fileId: savedFile.id
	};
}

export async function downloadDriveAppState(): Promise<DriveAppState | null> {
	assertAccessToken();
	const file = await findAppStateFile();
	if (!file) return null;

	const response = await driveFetch(`${DRIVE_FILES_URL}/${encodeURIComponent(file.id)}?alt=media`);
	const payload = parseDriveAppStatePayload(await response.json());
	if (!payload) {
		throw new Error('Drive app state file is not a supported Recurring Checklists state file.');
	}

	appStateFileId = file.id;
	return {
		state: payload.appState,
		updatedAt: payload.updatedAt,
		fileId: file.id
	};
}

export async function createPublicDriveJsonFile(
	filename: string,
	content: unknown
): Promise<PublicDriveFileResult> {
	assertAccessToken();
	const folder = await ensureSharedTemplatesFolder();
	const savedFile = await createJsonFile({
		metadata: {
			name: filename,
			parents: [folder.id],
			mimeType: 'application/json'
		},
		content,
		fields: 'id,name,webViewLink'
	});

	await driveFetch(`${DRIVE_FILES_URL}/${encodeURIComponent(savedFile.id)}/permissions?fields=id`, {
		method: 'POST',
		body: JSON.stringify({
			type: 'anyone',
			role: 'reader'
		}),
		headers: {
			'Content-Type': 'application/json'
		}
	});

	return {
		id: savedFile.id,
		name: savedFile.name,
		publicUrl: `https://drive.google.com/uc?export=download&id=${encodeURIComponent(savedFile.id)}`,
		webViewLink: savedFile.webViewLink || `https://drive.google.com/file/d/${savedFile.id}/view`
	};
}

export async function downloadDriveJsonFile(fileId: string): Promise<unknown> {
	assertAccessToken();
	const response = await driveFetch(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?alt=media`);
	return response.json() as Promise<unknown>;
}

export function driveFileIdFromUrl(fileUrl: string): string | null {
	let url: URL;
	try {
		url = new URL(fileUrl);
	} catch {
		return null;
	}

	if (!isGoogleDriveHost(url.hostname)) return null;

	const queryId = url.searchParams.get('id');
	if (queryId) return queryId;

	const pathMatch = url.pathname.match(/\/file\/d\/([^/]+)/);
	return pathMatch?.[1] ? decodeURIComponent(pathMatch[1]) : null;
}

async function ensureAppStateFile(): Promise<DriveFile> {
	if (appStateFileId) {
		return { id: appStateFileId, name: APP_STATE_FILENAME };
	}

	const existing = await findAppStateFile();
	if (existing) {
		appStateFileId = existing.id;
		return existing;
	}

	const created = await createJsonFile({
		metadata: {
			name: APP_STATE_FILENAME,
			parents: ['appDataFolder'],
			mimeType: 'application/json'
		},
		content: {
			version: 1,
			appSchemaVersion: 1,
			updatedAt: new Date(0).toISOString(),
			appState: {
				version: 1,
				checklists: [],
				completions: {}
			}
		},
		fields: 'id,name,modifiedTime'
	});
	appStateFileId = created.id;
	return created;
}

async function ensureSharedTemplatesFolder(): Promise<DriveFile> {
	if (sharedTemplatesFolderId) {
		return { id: sharedTemplatesFolderId, name: SHARED_TEMPLATES_FOLDER_NAME };
	}

	const existing = await findSharedTemplatesFolder();
	if (existing) {
		sharedTemplatesFolderId = existing.id;
		return existing;
	}

	const created = await createMetadataFile({
		metadata: {
			name: SHARED_TEMPLATES_FOLDER_NAME,
			mimeType: DRIVE_FOLDER_MIME_TYPE
		},
		fields: 'id,name,webViewLink'
	});
	sharedTemplatesFolderId = created.id;
	return created;
}

async function findAppStateFile(): Promise<DriveFile | undefined> {
	const params = new URLSearchParams({
		spaces: 'appDataFolder',
		fields: 'files(id,name,modifiedTime)',
		pageSize: '1',
		q: `name='${escapeDriveQueryValue(APP_STATE_FILENAME)}' and trashed=false`
	});
	const response = await driveFetch(`${DRIVE_FILES_URL}?${params.toString()}`);
	const data = (await response.json()) as DriveFileList;

	return data.files?.[0];
}

async function findSharedTemplatesFolder(): Promise<DriveFile | undefined> {
	const params = new URLSearchParams({
		fields: 'files(id,name,modifiedTime,webViewLink)',
		pageSize: '1',
		q: [
			`mimeType='${DRIVE_FOLDER_MIME_TYPE}'`,
			`name='${escapeDriveQueryValue(SHARED_TEMPLATES_FOLDER_NAME)}'`,
			'trashed=false'
		].join(' and ')
	});
	const response = await driveFetch(`${DRIVE_FILES_URL}?${params.toString()}`);
	const data = (await response.json()) as DriveFileList;

	return data.files?.[0];
}

async function createMetadataFile({
	metadata,
	fields
}: {
	metadata: object;
	fields: string;
}): Promise<DriveFile> {
	const response = await driveFetch(`${DRIVE_FILES_URL}?fields=${encodeURIComponent(fields)}`, {
		method: 'POST',
		body: JSON.stringify(metadata),
		headers: {
			'Content-Type': 'application/json'
		}
	});

	return (await response.json()) as DriveFile;
}

async function createJsonFile({
	metadata,
	content,
	fields
}: {
	metadata: object;
	content: unknown;
	fields: string;
}): Promise<DriveFile> {
	const multipart = multipartBody(metadata, content);
	const response = await driveFetch(
		`${DRIVE_UPLOAD_URL}?uploadType=multipart&fields=${encodeURIComponent(fields)}`,
		{
			method: 'POST',
			body: multipart.body,
			headers: multipart.headers
		}
	);

	return (await response.json()) as DriveFile;
}

async function updateJsonFile(
	fileId: string,
	content: unknown,
	fields: string
): Promise<DriveFile> {
	const metadata = {
		name: APP_STATE_FILENAME,
		mimeType: 'application/json'
	};
	const multipart = multipartBody(metadata, content);
	const response = await driveFetch(
		`${DRIVE_UPLOAD_URL}/${encodeURIComponent(fileId)}?uploadType=multipart&fields=${encodeURIComponent(fields)}`,
		{
			method: 'PATCH',
			body: multipart.body,
			headers: multipart.headers
		}
	);

	return (await response.json()) as DriveFile;
}

function parseDriveAppStatePayload(value: unknown): DriveAppStatePayload | null {
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

	const appState = normalizeAppState(value.appState);
	if (!appState) return null;

	return {
		version: 1,
		appSchemaVersion: appState.version,
		updatedAt: new Date(value.updatedAt).toISOString(),
		appState
	};
}

function multipartBody(metadata: object, content: unknown): { body: string; headers: HeadersInit } {
	const boundary = `drive-${crypto.randomUUID()}`;
	const body = [
		`--${boundary}`,
		'Content-Type: application/json; charset=UTF-8',
		'',
		JSON.stringify(metadata),
		`--${boundary}`,
		'Content-Type: application/json; charset=UTF-8',
		'',
		JSON.stringify(content, null, 2),
		`--${boundary}--`
	].join('\r\n');

	return {
		body,
		headers: {
			'Content-Type': `multipart/related; boundary=${boundary}`
		}
	};
}

async function driveFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
	assertAccessToken();
	const response = await fetch(input, {
		...init,
		headers: {
			...(init.headers ?? {}),
			Authorization: `Bearer ${accessToken}`
		}
	});

	if (!response.ok) {
		const message = await driveErrorMessage(response);
		if (response.status === 401) {
			await clearDriveToken();
		}
		throw new Error(message);
	}

	return response;
}

async function driveErrorMessage(response: Response): Promise<string> {
	try {
		const data = (await response.json()) as {
			error?: { message?: string };
		};
		return data.error?.message || `Google Drive request failed with HTTP ${response.status}.`;
	} catch {
		return `Google Drive request failed with HTTP ${response.status}.`;
	}
}

function loadGoogleIdentityScript(): Promise<void> {
	if (googleIdentity()?.accounts?.oauth2) return Promise.resolve();

	identityScriptPromise ??= new Promise((resolve, reject) => {
		const existingScript = document.querySelector<HTMLScriptElement>(
			`script[src="${GOOGLE_IDENTITY_SCRIPT}"]`
		);
		if (existingScript) {
			existingScript.addEventListener('load', () => resolve(), { once: true });
			existingScript.addEventListener(
				'error',
				() => reject(new Error('Google Identity Services failed to load.')),
				{
					once: true
				}
			);
			return;
		}

		const script = document.createElement('script');
		script.src = GOOGLE_IDENTITY_SCRIPT;
		script.async = true;
		script.defer = true;
		script.onload = () => resolve();
		script.onerror = () => reject(new Error('Google Identity Services failed to load.'));
		document.head.appendChild(script);
	});

	return identityScriptPromise;
}

function googleIdentity(): GoogleIdentity | undefined {
	return (window as Window & { google?: GoogleIdentity }).google;
}

function escapeDriveQueryValue(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function isGoogleDriveHost(hostname: string): boolean {
	return (
		hostname === 'drive.google.com' ||
		hostname === 'drive.usercontent.google.com' ||
		hostname === 'www.googleapis.com'
	);
}

async function storeDriveToken(): Promise<void> {
	if (!accessToken || !accessTokenExpiresAt) return;

	await setStoredValue(
		TOKEN_STORAGE_KEY,
		JSON.stringify({
			version: 1,
			accessToken,
			expiresAt: new Date(accessTokenExpiresAt).toISOString(),
			scope: DRIVE_SCOPE
		} satisfies StoredDriveToken)
	);
}

async function clearDriveToken(): Promise<void> {
	accessToken = '';
	accessTokenExpiresAt = 0;
	await removeStoredValue(TOKEN_STORAGE_KEY);
}

function normalizeStoredDriveToken(value: unknown): StoredDriveToken | null {
	if (
		typeof value !== 'object' ||
		value === null ||
		!('version' in value) ||
		value.version !== 1 ||
		!('accessToken' in value) ||
		typeof value.accessToken !== 'string' ||
		!('expiresAt' in value) ||
		typeof value.expiresAt !== 'string' ||
		!('scope' in value) ||
		value.scope !== DRIVE_SCOPE
	) {
		return null;
	}

	const expiresAt = Date.parse(value.expiresAt);
	if (
		!value.accessToken ||
		Number.isNaN(expiresAt) ||
		Date.now() >= expiresAt - TOKEN_EXPIRY_SKEW_MS
	) {
		return null;
	}

	return {
		version: 1,
		accessToken: value.accessToken,
		expiresAt: new Date(expiresAt).toISOString(),
		scope: DRIVE_SCOPE
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

async function removeStoredValue(key: string): Promise<void> {
	const database = await openDatabase();

	await new Promise<void>((resolve, reject) => {
		const transaction = database.transaction(STORE_NAME, 'readwrite');
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error);
		transaction.objectStore(STORE_NAME).delete(key);
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

function assertBrowser(): void {
	if (!browser) {
		throw new Error('Google Drive is only available in the browser.');
	}
}

function assertClientId(clientId: string): void {
	if (!clientId.trim()) {
		throw new Error('VITE_GOOGLE_CLIENT_ID is not configured.');
	}
}

function assertAccessToken(): void {
	if (!hasDriveToken()) {
		accessToken = '';
		accessTokenExpiresAt = 0;
		throw new Error('Authorize Google Drive first.');
	}
}
