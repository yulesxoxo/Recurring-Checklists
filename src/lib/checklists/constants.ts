import type { BaseFrequency, Frequency, Weekday } from './types';

export const STORAGE_KEY = 'recurring-checklists:v1';
export const DIRECT_LINK_PARAM = 'link';

export const productionFrequencies: BaseFrequency[] = ['daily', 'weekly', 'biweekly', 'interval'];
export const allFrequencies: Frequency[] = [...productionFrequencies];
export const weekdays: Weekday[] = [
	'monday',
	'tuesday',
	'wednesday',
	'thursday',
	'friday',
	'saturday',
	'sunday'
];
