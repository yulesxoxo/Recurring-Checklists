export const SHARE_IMPORT_PARAM = 'import';

export type ShareImportDecodeResult = { ok: true; url: string } | { ok: false; error: string };

export function encodeShareImportUrl(url: string): string {
	return base64UrlEncode(url);
}

export function decodeShareImportUrl(value: string): ShareImportDecodeResult {
	try {
		const decoded = base64UrlDecode(value);
		const url = new URL(decoded);

		if (url.protocol !== 'https:') {
			return { ok: false, error: 'Import URL must use HTTPS.' };
		}

		return { ok: true, url: url.toString() };
	} catch {
		return { ok: false, error: 'Import link is malformed.' };
	}
}

export function buildShareImportUrl(fileUrl: string, currentUrl: string): string {
	const url = new URL(currentUrl);
	url.pathname = '/';
	url.search = '';
	url.hash = '';
	url.searchParams.set(SHARE_IMPORT_PARAM, encodeShareImportUrl(fileUrl));
	return url.toString();
}

function base64UrlEncode(value: string): string {
	const bytes = new TextEncoder().encode(value);
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}

	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value: string): string {
	if (!/^[A-Za-z0-9_-]*$/.test(value)) {
		throw new Error('Invalid base64url value.');
	}

	const padded = value
		.replace(/-/g, '+')
		.replace(/_/g, '/')
		.padEnd(Math.ceil(value.length / 4) * 4, '=');
	const binary = atob(padded);
	const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
	return new TextDecoder().decode(bytes);
}
