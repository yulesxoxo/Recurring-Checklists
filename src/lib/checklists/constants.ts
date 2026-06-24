import type { BaseFrequency, DevFrequency, Frequency, Weekday } from './types';

export const STORAGE_KEY = 'recurring-checklists:v1';
export const DIRECT_LINK_PARAM = 'view';

export const productionFrequencies: BaseFrequency[] = ['daily', 'weekly', 'biweekly'];
export const devFrequencies: DevFrequency[] = ['hourly', 'minutely'];
export const allFrequencies: Frequency[] = [...productionFrequencies, ...devFrequencies];
export const weekdays: Weekday[] = [
	'sunday',
	'monday',
	'tuesday',
	'wednesday',
	'thursday',
	'friday',
	'saturday'
];
