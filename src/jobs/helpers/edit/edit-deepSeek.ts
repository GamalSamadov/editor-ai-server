import OpenAI from 'openai'

import { logger } from '@/lib/logger'

const client = new OpenAI({
	apiKey: process.env.DEEPSEEK_API_KEY,
	baseURL: 'https://api.deepseek.com/v1'
})

export async function editDeepSeek(
	text: string,
	prompt: string
): Promise<string | null> {
	try {
		const result = await client.chat.completions.create({
			model: 'deepseek-reasoner',
			messages: [{ role: 'user', content: `${prompt}${text}` }]
		})

		const message = result.choices[0].message
		return message ? message.content : null
	} catch (error) {
		logger.error('Error in editChatGPT:', error)
		return null
	}
}
