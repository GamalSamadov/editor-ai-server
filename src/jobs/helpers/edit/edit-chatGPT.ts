import OpenAI from 'openai'

import { logger } from '@/lib/logger'

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function editChatGPT(
	text: string,
	prompt: string
): Promise<string | null> {
	try {
		const result = await client.chat.completions.create({
			// model: 'chatgpt-4o-latest',
			model: 'gpt-4.1',
			// model: 'o1',
			store: true,
			messages: [{ role: 'user', content: `${prompt}${text}` }]
		})

		const message = result.choices[0].message
		return message ? message.content : null
	} catch (error) {
		logger.error('Error in editChatGPT:', error)
		return null
	}
}
