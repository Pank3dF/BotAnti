import dotenv from 'dotenv';
dotenv.config();

if (!process.env.BOT_TOKEN) throw new Error('❌ BOT_TOKEN не указан в .env');

const toBool = (v?: string) => v?.toLowerCase() === 'true' || v === '1';

export const BOT_TOKEN = process.env.BOT_TOKEN;

export const ADMINS = process.env.ADMINS
	? process.env.ADMINS.split(',')
			.map(x => Number(x.trim()))
			.filter(Boolean)
	: [];

export const ALLOWED_CHATS = process.env.ALLOWED_CHATS
	? process.env.ALLOWED_CHATS.split(',')
			.map(x => Number(x.trim()))
			.filter(Boolean)
	: [];

export const LOG_CHAT_ID = process.env.LOG_CHAT_ID
	? Number(process.env.LOG_CHAT_ID)
	: null;

export const FILTER_PROFANITY = toBool(process.env.FILTER_PROFANITY);
export const FILTER_ADVERTISING = toBool(process.env.FILTER_ADVERTISING);

export const PROFANITY_WORDS = process.env.PROFANITY_WORDS
	? process.env.PROFANITY_WORDS.split(',')
			.map(w => w.trim().toLowerCase())
			.filter(Boolean)
	: [];

export const AD_KEYWORDS = process.env.AD_KEYWORDS
	? process.env.AD_KEYWORDS.split(',')
			.map(w => w.trim().toLowerCase())
			.filter(Boolean)
	: [];
