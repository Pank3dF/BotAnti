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
import { FILTER_PROFANITY, FILTER_ADVERTISING } from './state.js';
import { registerAdminPanel, initAdminDB } from './admin.js';

async function main() {
	await initDB();
	await initAdminDB();

	// Диагностика: печатаем ADMINS чтобы убедиться, что список загружен правильно
	console.log('ADMINS:', ADMINS);

	updateCustom(await getWords('custom_words'));
	const bot = new Bot(BOT_TOKEN);
	registerAdminPanel(bot);

	// Диагностика: проверяем, что бот корректно авторизовался
	bot.api
		.getMe()
		.then(botInfo => {
			console.log(`Запущен бот: @${botInfo.username} (id: ${botInfo.id})`);
		})
		.catch(err => {
			console.error('Ошибка getMe():', err);
		});

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

	// команда для отключения режима (удобно для теста)
	bot.command('stop_check_chat', async ctx => {
		console.log('COMMAND /stop_check_chat invoked by', ctx.from?.id);
		if (!ctx.from || !ADMINS.includes(ctx.from.id)) {
			return ctx.reply('❌ У тебя нет доступа к этой команде');
		}
		isCheckingChat = false;
		await ctx.reply('🛑 Режим анализа отключён.');
	});

	// === Основной обработчик сообщений ===
	bot.on('message', async ctx => {
		try {
			// --- лёгкое логирование входящих сообщений для диагностики ---
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

		// Проверка фильтров
		if (FILTER_PROFANITY && checkProfanity(text))
			violation = 'violation_profanity';
		if (FILTER_ADVERTISING && checkAd(text)) violation = 'violation_ad';
		if (checkCustom(text)) violation = 'violation_custom';

		const db = await dbPromise;
		await db.run('INSERT INTO statistics (type,timestamp) VALUES (?,?)', [
			violation || 'message_ok',
			Math.floor(Date.now() / 1000),
		]);

		// === Логирование нарушений ===
		if (violation && LOG_CHAT_ID) {
			try {
				await bot.api.sendMessage(
					LOG_CHAT_ID,
					`🚨 Нарушение!\n📌 Чат: ${chatId} (${
						ctx.chat.title || 'ЛС'
					})\n👤 Пользователь: ${
						ctx.from?.username ? '@' + ctx.from.username : ctx.from?.first_name
					} (${ctx.from?.id})\nТип нарушения: ${violation}\nТекст: ${
						ctx.message.text ?? ctx.message.caption ?? '<no text>'
					}`
				);
				await bot.api.forwardMessage(
					LOG_CHAT_ID,
					chatId,
					ctx.message.message_id
				);
			} catch (err) {
				console.error('Ошибка при логировании нарушения:', err);
			}
		}

		// === Режим анализа /check_chat ===
		if (isCheckingChat && ctx.from && ADMINS.includes(ctx.from.id)) {
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

			if (checkProfanity(checkText)) checkViolation = 'violation_profanity';
			if (checkAd(checkText)) checkViolation = 'violation_ad';
			if (checkCustom(checkText)) checkViolation = 'violation_custom';

			if (checkViolation) {
				await db.run('INSERT INTO statistics (type,timestamp) VALUES (?,?)', [
					checkViolation,
					Math.floor(Date.now() / 1000),
				]);

				// отправляем лог в LOG_CHAT_ID (если указан)
				if (LOG_CHAT_ID) {
					await ctx.api.sendMessage(
						LOG_CHAT_ID,
						`🚨 Нарушение (анализ сообщений после /check_chat)!\n👤 Пользователь: ${
							ctx.from?.username
								? '@' + ctx.from.username
								: ctx.from?.first_name
						}\nТекст: ${checkText}\nТип: ${checkViolation}`
					);
				}
			}
		}
	});

	bot.start();
	console.log('Бот запущен 🚀');
}

main().catch(err => console.error('Ошибка в боте:', err));
