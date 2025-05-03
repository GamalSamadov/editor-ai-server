import { GoogleGenerativeAI } from '@google/generative-ai'
import dotenv from 'dotenv'

dotenv.config()

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY)

const model = genAI.getGenerativeModel({
	model: 'gemini-2.5-pro-preview'
})

export async function editGemini(
	googleText: string,
	prompt: string
): Promise<string> {
	try {
		const fullPrompt = `${prompt}\n\n${googleText}`

		const result = await model.generateContent(fullPrompt)
		const response = result.response

		if (!response) {
			console.error('Gemini API returned no response object.')
			throw new Error('Gemini API returned no response.')
		}

		const text = response.text()
		if (text === undefined || text === null || text.trim() === '') {
			const finishReason = response.candidates?.[0]?.finishReason
			const safetyRatings = response.candidates?.[0]?.safetyRatings
			console.error(
				'Gemini API returned an empty or invalid text response.',
				{ finishReason, safetyRatings }
			)
			if (
				finishReason === 'SAFETY' ||
				finishReason === 'RECITATION' ||
				finishReason === 'OTHER'
			) {
				throw new Error(
					`Gemini API request was blocked or returned empty text. Finish Reason: ${finishReason}`
				)
			}
			throw new Error(
				`Gemini API returned empty text. Finish Reason: ${finishReason || 'Unknown'}`
			)
		}

		return text
	} catch (error) {
		console.error(
			`Error calling Gemini API with model '${model.model}':`,
			error
		)
		if (
			error.message &&
			(error.message.includes('not found') ||
				error.message.includes('permission denied'))
		) {
			throw new Error(
				`Gemini API call failed: Model '${model.model}' not found or permission denied. Please verify the model ID and your API key access. Original error: ${error.message}`
			)
		}
		throw new Error(`Gemini API call failed: ${error.message || error}`)
	}
}
