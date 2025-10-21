import axios from 'axios';
import { getCurrentModel } from './state';

const NEURAL_API_URL = 'http://10.8.0.24:11434/v1/chat/completions';

export const AVAILABLE_MODELS = [
	'qwen2.5-coder:7b',
	'qwen3:30b',
	'hf.co/bartowski/Qwen_Qwen3-30B-A3B-Thinking-2507-GGUF:Q4_K_M',
	'hf.co/unsloth/Qwen3-30B-A3B-Instruct-2507-GGUF:Q4_K_M',
];

// Упрощенные типы или используем any для избежания ошибок
interface NeuralApiResponse {
	choices?: Array<{
		message?: {
			content?: string;
		};
		finish_reason?: string;
	}>;
}

// Настройки тематик
export interface TopicConfig {
	name: string;
	systemPrompt: string;
	keywords: string[];
	priority: number;
	enabled: boolean;
}

// Конфигурация тематик
export const TOPICS: TopicConfig[] = [
	{
		name: 'bad_words',
		systemPrompt: `Ты - детектор нежелательного контента. Твоя задача - определить содержит ли сообщение:
- Матерные слова, нецензурную лексику, ругательства
- Оскорбления, унижения, личные нападки
- Токсичное поведение, агрессию, угрозы
- Унизительные высказывания в чей-либо адрес
- Неуважительные обращения к собеседникам

Проанализируй сообщение и определи, нарушает ли оно правила общения.
Если нарушение есть - ответь "ДА", если сообщение нормальное - ответь "НЕТ".`,
		keywords: [],
		priority: 1,
		enabled: true,
	},
	{
		name: 'cars',
		systemPrompt: `Ты - детектор автомобильной тематики. Определи, относится ли сообщение к:
- Автомобилям, машинам, транспорту
- Запчастям, ремонту, техническому обслуживанию
- Вождению, правилам дорожного движения
- Автомобильным брендам, моделям, маркам
- Покупке, продаже, аренде автомобилей

Если тема сообщения автомобильная - ответь "ДА", если нет - ответь "НЕТ".`,
		keywords: [],
		priority: 2,
		enabled: true,
	},
	{
		name: 'advertising',
		systemPrompt: `Ты - детектор рекламы и спама. Определи, содержит ли сообщение:
- Рекламные предложения товаров или услуг
- Призывы к покупке, продаже, заказу
- Коммерческие предложения
- Спам-рассылку, массовые приглашения
- Ссылки на магазины, сайты, каналы

Если это реклама или спам - ответь "ДА", если обычное сообщение - ответь "НЕТ".`,
		keywords: [],
		priority: 3,
		enabled: true,
	},
];

// Результат анализа
export interface NeuralResult {
	topic: string;
	detected: boolean;
	confidence?: number;
	reason?: string;
}

// Основная функция анализа
export async function analyzeWithNeural(
	message: string,
	topicName: string
): Promise<NeuralResult> {
	try {
		const topic = TOPICS.find(t => t.name === topicName);
		if (!topic || !topic.enabled) {
			return { topic: topicName, detected: false };
		}
		const currentModel = getCurrentModel();
		console.log(
			`🧠 Запуск нейросети для темы "${topicName}":`,
			message.substring(0, 100)
		);

		// Используем any для response data чтобы избежать проблем с типами
		const response = await axios.post(
			NEURAL_API_URL,
			{
				model: currentModel,
				messages: [
					{
						role: 'system',
						content: topic.systemPrompt,
					},
					{
						role: 'user',
						content: `Сообщение для анализа: "${message}"`,
					},
				],
				temperature: 0.1,
				max_tokens: 50,
			},
			{
				timeout: 15000,
				headers: {
					'Content-Type': 'application/json',
				},
			}
		);

		// Безопасное извлечение данных с проверками
		const data = response.data as any;

		console.log('🧠 Полный ответ нейросети:', JSON.stringify(data, null, 2));

		// Проверяем разные возможные структуры ответа
		let content: string | undefined;

		if (data.choices && Array.isArray(data.choices) && data.choices[0]) {
			// Стандартная структура OpenAI
			content = data.choices[0]?.message?.content;
		} else if (data.response) {
			// Альтернативная структура
			content = data.response;
		} else if (data.content) {
			// Другая возможная структура
			content = data.content;
		} else {
			console.warn('Неизвестная структура ответа нейросети:', data);
			return { topic: topicName, detected: false };
		}

		if (!content) {
			console.warn('Нейросеть вернула пустой ответ');
			return { topic: topicName, detected: false };
		}

		const answer = content.trim().toUpperCase();
		const detected = answer.includes('ДА');

		console.log(`🧠 Результат нейросети [${topicName}]:`, {
			answer: content,
			detected,
			finish_reason: data.choices?.[0]?.finish_reason,
		});

		return {
			topic: topicName,
			detected,
			reason: content,
		};
	} catch (error: any) {
		console.error(`Ошибка нейросети (${topicName}):`, error.message);

		if (error.response) {
			console.error('Детали ошибки:', error.response.data);
		}

		return {
			topic: topicName,
			detected: false,
			reason: 'API Error: ' + error.message,
		};
	}
}

export async function analyzeSequentially(
	message: string
): Promise<NeuralResult | null> {
	// Сортируем темы по приоритету (от высшего к низшему)
	const sortedTopics = [...TOPICS]
		.filter(topic => topic.enabled)
		.sort((a, b) => a.priority - b.priority);

	for (const topic of sortedTopics) {
		const result = await analyzeWithNeural(message, topic.name);

		if (result.detected) {
			console.log(
				`🚨 Обнаружено нарушение в теме ${topic.name}, остальные проверки пропускаются`
			);
			return result;
		}
	}

	return null; // Нарушений не обнаружено
}

// Массовый анализ по всем темам
export async function analyzeAllTopics(
	message: string
): Promise<NeuralResult[]> {
	const promises = TOPICS.filter(topic => topic.enabled).map(topic =>
		analyzeWithNeural(message, topic.name)
	);

	return Promise.all(promises);
}

// Получить активные темы
export function getActiveTopics(): TopicConfig[] {
	return TOPICS.filter(topic => topic.enabled);
}

// Включить/выключить тему
export function toggleTopic(topicName: string, enabled: boolean): boolean {
	const topic = TOPICS.find(t => t.name === topicName);
	if (topic) {
		topic.enabled = enabled;
		return true;
	}
	return false;
}
export function getTopicsByPriority(): TopicConfig[] {
	return [...TOPICS].sort((a, b) => a.priority - b.priority);
}