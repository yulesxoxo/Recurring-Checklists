export function insertArrayItem<T>(items: T[], item: T, position = items.length): T[] {
	const index = clampIndex(position, 0, items.length);
	return [...items.slice(0, index), item, ...items.slice(index)];
}

export function moveArrayItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
	const nextIndex = index + direction;
	if (index < 0 || index >= items.length || nextIndex < 0 || nextIndex >= items.length) {
		return items;
	}

	const moved = [...items];
	[moved[index], moved[nextIndex]] = [moved[nextIndex], moved[index]];
	return moved;
}

function clampIndex(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) return max;
	return Math.min(Math.max(Math.trunc(value), min), max);
}
