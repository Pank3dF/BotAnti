import { Bot } from 'grammy';
import { BOT_TOKEN, ALLOWED_CHATS, LOG_CHAT_ID, ADMINS } from './config.js';
import { dbPromise, initDB, getWords } from './db.js';
import {
	updateProfanity,
	updateAd,
	updateCustom,
	checkProfanity,
	checkAd,
	checkCustom,
} from './filters.js';
import {
	FILTER_PROFANITY,
	FILTER_ADVERTISING,
	USE_NEURAL_NETWORK,
} from './state.js';
import { registerAdminPanel, initAdminDB } from './admin.js';
import { analyzeAllTopics, analyzeSequentially } from './neural.js';

async function main() {
	await initDB();
	await initAdminDB();

	console.log('ADMINS:', ADMINS);
	updateCustom(await getWords('custom_words'));
	const bot = new Bot(BOT_TOKEN);
	registerAdminPanel(bot);

	// Проверка прав бота в чате
	async function checkBotPermissions(chatId: number): Promise<boolean> {
		try {
			const chatMember = await bot.api.getChatMember(
				chatId,
				(
					await bot.api.getMe()
				).id
			);
			if (chatMember.status === 'administrator') {
				const permissions = (chatMember as any).can_delete_messages;
				return permissions === true;
			}
			return false;
		} catch (error) {
			console.log('Бот не админ в чате:', chatId);
			return false;
		}
	}

	// Действия при нарушении
	async function handleViolation(ctx: any, violationType: string) {
		const chatId = ctx.chat.id;
		const messageId = ctx.message.message_id;
		const userId = ctx.from.id;
		const text = ctx.message.text || ctx.message.caption || '';

		// Логируем в базу
		const db = await dbPromise;
		await db.run('INSERT INTO statistics (type,timestamp) VALUES (?,?)', [
			violationType,
			Math.floor(Date.now() / 1000),
		]);

		// Отправляем в лог-чат
		if (LOG_CHAT_ID) {
			try {
				await bot.api.sendMessage(
					LOG_CHAT_ID,
					`🚨 Нарушение!\n📌 Чат: ${chatId} (${
						ctx.chat.title || 'ЛС'
					})\n👤 Пользователь: ${
						ctx.from?.username ? '@' + ctx.from.username : ctx.from?.first_name
					} (${userId})\nТип нарушения: ${violationType}\nТекст: ${text}`
				);
				await bot.api.forwardMessage(LOG_CHAT_ID, chatId, messageId);
			} catch (err) {
				console.error('Ошибка при логировании нарушения:', err);
			}
		}

		// Пытаемся удалить сообщение если бот админ
		try {
			const isAdmin = await checkBotPermissions(chatId);
			if (isAdmin && ctx.chat.type !== 'private') {
				// Сначала отправляем предупреждение
				const warning = await ctx.reply(
					`⚠️ Сообщение от @${
						ctx.from.username || ctx.from.first_name
					} удалено.\nПричина: ${getViolationReason(violationType)}`
				);

				// Затем удаляем нарушающее сообщение
				await bot.api.deleteMessage(chatId, messageId);

				// Удаляем предупреждение через 10 секунд
				setTimeout(async () => {
					try {
						await bot.api.deleteMessage(chatId, warning.message_id);
					} catch (e) {
						// Игнорируем ошибки удаления предупреждения
					}
				}, 10000);
			} else if (ctx.chat.type === 'private') {
				// В личке просто уведомляем
				await ctx.reply(
					`❌ Ваше сообщение содержит запрещенный контент. Причина: ${getViolationReason(
						violationType
					)}`
				);
			}
		} catch (error) {
			console.error('Ошибка при обработке нарушения:', error);
		}
	}

	function getViolationReason(type: string): string {
		const reasons = {
			violation_profanity: 'ненормативная лексика',
			violation_ad: 'реклама',
			violation_custom: 'запрещенные слова',
			neural_bad_words: 'нежелательный контент (нейросеть)',
			neural_cars: 'автомобильная тема (нейросеть)',
			neural_advertising: 'реклама (нейросеть)',
		};
		return reasons[type as keyof typeof reasons] || 'нарушение правил';
	}

	let isCheckingChat = false;

	// === Команда /check_chat ===
	bot.command('check_chat', async ctx => {
		console.log(
			'COMMAND /check_chat invoked by',
			ctx.from?.id,
			ctx.from?.username
		);

		if (!ctx.from || !ADMINS.includes(ctx.from.id)) {
			console.log('-> access denied for', ctx.from?.id, 'ADMINS:', ADMINS);
			return ctx.reply('❌ У тебя нет доступа к этой команде');
		}

		isCheckingChat = true;
		console.log('-> check_chat enabled by', ctx.from?.id);
		await ctx.reply(
			'✅ Бот готов анализировать все сообщения, которые ты пришлёшь в ЛС.\n📩 Просто отправь сообщения, и я их проверю на нарушения.'
		);
	});

	// команда для отключения режима
	bot.command('stop_check_chat', async ctx => {
		console.log('COMMAND /stop_check_chat invoked by', ctx.from?.id);
		if (!ctx.from || !ADMINS.includes(ctx.from.id)) {
			return ctx.reply('❌ У тебя нет доступа к этой команде');
		}
		isCheckingChat = false;
		await ctx.reply('🛑 Режим анализа отключён.');
	});

	// Команда для проверки прав бота
	bot.command('check_permissions', async ctx => {
		if (ctx.chat.type === 'private') {
			return ctx.reply('ℹ️ Эта команда работает только в группах и каналах');
		}

		if (!ctx.from || !ADMINS.includes(ctx.from.id)) {
			return ctx.reply('❌ У тебя нет доступа к этой команде');
		}

		const hasPermissions = await checkBotPermissions(ctx.chat.id);
		if (hasPermissions) {
			await ctx.reply('✅ Бот имеет необходимые права администратора');
		} else {
			await ctx.reply(
				'❌ Бот не имеет прав администратора или прав недостаточно. Требуются права на удаление сообщений.'
			);
		}
	});

	// === Основной обработчик сообщений ===
	bot.on('message', async ctx => {
		try {
			console.log('--- incoming message ---');
			console.log(
				'from:',
				ctx.from?.id,
				ctx.from?.username,
				ctx.from?.first_name
			);
			console.log('chat:', ctx.chat.id, ctx.chat.type, ctx.chat.title);
			console.log(
				'text:',
				ctx.message?.text ?? '<no text>',
				'caption:',
				ctx.message?.caption ?? '<no caption>'
			);
		} catch (e) {
			console.error('diag log error:', e);
		}

		const msgText = ctx.message.text ?? ctx.message.caption;
		const chatId = ctx.chat.id;

		// Проверка на разрешённые чаты
		if (ctx.chat.type !== 'private') {
			if (ALLOWED_CHATS.length > 0 && !ALLOWED_CHATS.includes(chatId)) return;
		}

		const text = msgText?.toLowerCase() || '';
		let violation: string | null = null;

		// === ПРОВЕРКА НЕЙРОСЕТЬЮ ===
		// === ПРОВЕРКА НЕЙРОСЕТЬЮ ===
		if (USE_NEURAL_NETWORK && text && text.length > 3) {
			try {
				console.log('🧠 Запуск последовательного анализа нейросетью...');

				// Используем последовательный анализ вместо массового
				const neuralViolation = await analyzeSequentially(text);

				if (neuralViolation) {
					violation = `neural_${neuralViolation.topic}`;
					console.log(
						`🧠 Нейросеть обнаружила нарушение: ${neuralViolation.topic}`
					);
				} else {
					console.log('🧠 Нейросеть не обнаружила нарушений');
				}
			} catch (error) {
				console.error('Ошибка нейросети:', error);
			}
		}
		// Проверка обычных фильтров
		if (FILTER_PROFANITY && checkProfanity(text))
			violation = 'violation_profanity';
		if (FILTER_ADVERTISING && checkAd(text)) violation = 'violation_ad';
		if (checkCustom(text)) violation = 'violation_custom';

		// Обрабатываем нарушение
		if (violation) {
			await handleViolation(ctx, violation);
		} else {
			// Логируем нормальные сообщения
			const db = await dbPromise;
			await db.run('INSERT INTO statistics (type,timestamp) VALUES (?,?)', [
				'message_ok',
				Math.floor(Date.now() / 1000),
			]);
		}

		// === Режим анализа /check_chat ===
		if (
			isCheckingChat &&
			ctx.from &&
			ADMINS.includes(ctx.from.id) &&
			ctx.chat.type === 'private'
		) {
			const checkText = (
				ctx.message.text ??
				ctx.message.caption ??
				''
			).toLowerCase();
			if (!checkText) {
				await ctx.reply('⚠️ Пустое сообщение — текст или подпись отсутствуют.');
				return;
			}

			let checkViolation: string | null = null;

			// Проверка нейросетью в режиме анализа
			if (USE_NEURAL_NETWORK) {
				try {
					const neuralResults = await analyzeAllTopics(checkText);
					const neuralViolation = neuralResults.find(result => result.detected);
					if (neuralViolation) {
						checkViolation = `neural_${neuralViolation.topic}`;
					}
				} catch (error) {
					console.error('Ошибка нейросети в check_chat:', error);
				}
			}

			// Обычные проверки
			if (checkProfanity(checkText)) checkViolation = 'violation_profanity';
			if (checkAd(checkText)) checkViolation = 'violation_ad';
			if (checkCustom(checkText)) checkViolation = 'violation_custom';

			if (checkViolation) {
				await ctx.reply(
					`🚨 Обнаружено нарушение: ${getViolationReason(checkViolation)}`
				);
			} else {
				await ctx.reply('✅ Нарушений не обнаружено');
			}
		}
	});
	bot.catch(err => {
		console.error('Ошибка бота:', err);
	});

	// Обработка новых участников (можно добавить проверку при входе)
	bot.on('message:new_chat_members', async ctx => {
		// Можно добавить приветственное сообщение с правилами
	});

	bot.start();
	console.log('Бот запущен 🚀');
}

main().catch(err => console.error('Ошибка в боте:', err));
