import { GoogleGenerativeAI } from '@google/generative-ai'
import dotenv from 'dotenv'

dotenv.config()

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY)

const model = genAI.getGenerativeModel({
	model: 'gemini-2.0-flash-thinking-exp'
})

export async function editGemini(googleText: string, prompt: string) {
	const result = await model.generateContent(`${prompt}${googleText}`)

	return result.response.text()
}
