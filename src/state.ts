
export let FILTER_PROFANITY = true;
export let FILTER_ADVERTISING = true;

export function toggleProfanity(): boolean {
	FILTER_PROFANITY = !FILTER_PROFANITY;
	return FILTER_PROFANITY;
}

export function toggleAdvertising(): boolean {
	FILTER_ADVERTISING = !FILTER_ADVERTISING;
	return FILTER_ADVERTISING;
}

export function setProfanity(state: boolean) {
	FILTER_PROFANITY = state;
}
export function setAdvertising(state: boolean) {
	FILTER_ADVERTISING = state;
}
