import { Bot, InlineKeyboard, Context } from 'grammy';
import { ADMINS, PROFANITY_WORDS, AD_KEYWORDS } from './config.js';
import { dbPromise, addWord, deleteWord, getWords } from './db.js';
import {
	updateProfanity,
	updateAd,
	updateCustom,
	profanityWords,
	adWords,
	customWords,
} from './filters.js';
import {
	FILTER_PROFANITY,
	FILTER_ADVERTISING,
	toggleProfanity,
	toggleAdvertising,
} from './state.js';

export async function initAdminDB() {
	const profanity = await getWords('profanity_words');
	const ad = await getWords('ad_keywords');
	const custom = await getWords('custom_words');

	if (profanity.length === 0 && PROFANITY_WORDS.length > 0) {
		for (const word of PROFANITY_WORDS) await addWord('profanity_words', word);
	}
	if (ad.length === 0 && AD_KEYWORDS.length > 0) {
		for (const word of AD_KEYWORDS) await addWord('ad_keywords', word);
	}

	updateProfanity(await getWords('profanity_words'));
	updateAd(await getWords('ad_keywords'));
	updateCustom(await getWords('custom_words'));
}

function mainAdminKeyboard() {
	return new InlineKeyboard()
		.text(`${FILTER_PROFANITY ? '✅' : '❌'} Брань`, 'toggle_profanity')
		.row()
		.text(`${FILTER_ADVERTISING ? '✅' : '❌'} Реклама`, 'toggle_ad')
		.row()
		.text('📊 Статистика', 'show_statistics')
		.row()
		.text('📝 Список слов', 'list_words')
		.row()
		.text('📜 Команды', 'show_commands');
}

function backToAdminKeyboard() {
	return new InlineKeyboard().text('⬅️ Назад в панель', 'back_to_admin');
}

export function registerAdminPanel(bot: Bot<Context>) {
	// === Команда /admin ===
	bot.command('admin', async ctx => {
		if (!ctx.from || !ADMINS.includes(ctx.from.id)) return;
		if (!ctx.chat || ctx.chat.type !== 'private') {
			return ctx.reply('⚠️ Админ-панель доступна только в личке с ботом');
		}

		await ctx.reply('Панель администратора:', {
			reply_markup: mainAdminKeyboard(),
		});
	});

	// === Обработка inline кнопок ===
	bot.on('callback_query:data', async ctx => {
		if (!ctx.from || !ADMINS.includes(ctx.from.id)) {
			return ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
		}

		const db = await dbPromise;
		const data = ctx.callbackQuery?.data;
		if (!data) return;

		switch (data) {
			case 'toggle_profanity':
				await ctx.editMessageText(
					`Фильтр брани: ${toggleProfanity() ? '✅ Вкл' : '❌ Выкл'}`,
					{ reply_markup: backToAdminKeyboard() }
				);
				break;

			case 'toggle_ad':
				await ctx.editMessageText(
					`Фильтр рекламы: ${toggleAdvertising() ? '✅ Вкл' : '❌ Выкл'}`,
					{ reply_markup: backToAdminKeyboard() }
				);
				break;

			case 'show_statistics': {
				const now = Math.floor(Date.now() / 1000);
				const oneHourAgo = now - 3600;
				const oneWeekAgo = now - 7 * 24 * 3600;
				const getCount = async (q: string, p: any[] = []) =>
					((await db.get(q, p)) as { c: number } | undefined)?.c ?? 0;

				const lastHour = await getCount(
					'SELECT COUNT(*) as c FROM statistics WHERE timestamp > ?',
					[oneHourAgo]
				);
				const lastWeek = await getCount(
					'SELECT COUNT(*) as c FROM statistics WHERE timestamp > ?',
					[oneWeekAgo]
				);
				const allTime = await getCount('SELECT COUNT(*) as c FROM statistics');
				const violationsAll = await getCount(
					"SELECT COUNT(*) as c FROM statistics WHERE type IN ('violation_ad','violation_profanity','violation_custom')"
				);

				await ctx.editMessageText(
					`📊 Статистика:\nПоследний час: ${lastHour}\nПоследняя неделя: ${lastWeek}\nВсего: ${allTime} (нарушений: ${violationsAll})`,
					{ reply_markup: backToAdminKeyboard() }
				);
				break;
			}

			case 'list_words':
				await ctx.editMessageText(
					`📝 Список слов:\n🚫 Брань: ${
						[...profanityWords].join(', ') || 'нет'
					}\n📢 Реклама: ${
						[...adWords].join(', ') || 'нет'
					}\n🧩 Пользовательские: ${[...customWords].join(', ') || 'нет'}`,
					{ reply_markup: backToAdminKeyboard() }
				);
				break;

			case 'show_commands':
				await ctx.editMessageText(
					`📜 Команды администратора:\n\n/admin — открыть панель\n/check_chat — анализ ЛС\n/add_profanity <слово>\n/del_profanity <слово>\n/add_ad <слово>\n/del_ad <слово>\n/add_custom <слово>\n/del_custom <слово>`,
					{ reply_markup: backToAdminKeyboard() }
				);
				break;

			case 'back_to_admin':
				await ctx.editMessageText('Панель администратора:', {
					reply_markup: mainAdminKeyboard(),
				});
				break;
		}

		await ctx.answerCallbackQuery();
	});

	// === Команды добавления / удаления слов ===
	['profanity', 'ad'].forEach(type => {
		const table = type === 'profanity' ? 'profanity_words' : 'ad_keywords';

		bot.command(`add_${type}`, async ctx => {
			if (!ctx.from || !ADMINS.includes(ctx.from.id)) return;

			const text = ctx.message?.text;
			if (!text) return ctx.reply(`❌ Укажи слово: /add_${type} слово`);

			const word = text.split(' ').slice(1).join(' ').toLowerCase();
			if (!word) return ctx.reply(`❌ Укажи слово: /add_${type} слово`);

			await addWord(table, word);
			type === 'profanity'
				? updateProfanity(await getWords(table))
				: updateAd(await getWords(table));

			await ctx.reply(`✅ Добавлено слово: ${word}`);
		});

		bot.command(`del_${type}`, async ctx => {
			if (!ctx.from || !ADMINS.includes(ctx.from.id)) return;

			const text = ctx.message?.text;
			if (!text) return ctx.reply(`❌ Укажи слово: /del_${type} слово`);

			const word = text.split(' ').slice(1).join(' ').toLowerCase();
			if (!word) return ctx.reply(`❌ Укажи слово: /del_${type} слово`);

			await deleteWord(table, word);
			type === 'profanity'
				? updateProfanity(await getWords(table))
				: updateAd(await getWords(table));

			await ctx.reply(`✅ Удалено слово: ${word}`);
		});
	});

	// === Пользовательские слова ===
	bot.command('add_custom', async ctx => {
		if (!ctx.from || !ADMINS.includes(ctx.from.id)) return;

		const text = ctx.message?.text;
		if (!text) return ctx.reply('❌ Укажи слово: /add_custom слово');

		const word = text.split(' ').slice(1).join(' ').toLowerCase();
		if (!word) return ctx.reply('❌ Укажи слово: /add_custom слово');

		await addWord('custom_words', word);
		updateCustom(await getWords('custom_words'));
		await ctx.reply(`✅ Добавлено слово в фильтр: ${word}`);
	});

	bot.command('del_custom', async ctx => {
		if (!ctx.from || !ADMINS.includes(ctx.from.id)) return;

		const text = ctx.message?.text;
		if (!text) return ctx.reply('❌ Укажи слово: /del_custom слово');

		const word = text.split(' ').slice(1).join(' ').toLowerCase();
		if (!word) return ctx.reply('❌ Укажи слово: /del_custom слово');

		await deleteWord('custom_words', word);
		updateCustom(await getWords('custom_words'));
		await ctx.reply(`✅ Удалено слово из фильтра: ${word}`);
	});
}
