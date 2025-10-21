export let FILTER_PROFANITY = true;
export let FILTER_ADVERTISING = true;
export let USE_NEURAL_NETWORK = true; // Добавляем переключатель для нейросети
export let CURRENT_MODEL = 'qwen2.5-coder:7b'; 

export function toggleProfanity(): boolean {
	FILTER_PROFANITY = !FILTER_PROFANITY;
	return FILTER_PROFANITY;
}

export function toggleAdvertising(): boolean {
	FILTER_ADVERTISING = !FILTER_ADVERTISING;
	return FILTER_ADVERTISING;
}

export function toggleNeuralNetwork(): boolean {
	USE_NEURAL_NETWORK = !USE_NEURAL_NETWORK;
	return USE_NEURAL_NETWORK;
}

export function setProfanity(state: boolean) {
	FILTER_PROFANITY = state;
}

export function setAdvertising(state: boolean) {
	FILTER_ADVERTISING = state;
}

export function setNeuralNetwork(state: boolean) {
	USE_NEURAL_NETWORK = state;
}

export function setCurrentModel(model: string): void {
	CURRENT_MODEL = model;
}

export function getCurrentModel(): string {
	return CURRENT_MODEL;
}