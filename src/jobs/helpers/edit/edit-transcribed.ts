import { GoogleGenerativeAI } from '@google/generative-ai'
import dotenv from 'dotenv'

dotenv.config()

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY)

const model = genAI.getGenerativeModel({
	model: 'gemini-2.0-flash-thinking-exp'
})

const prompt = `Men senga matn beraman. Matnni to'g'irlashing kerak ushbu narsalarni rioya qilgan holda:\n- Matndagi tinish belgilari to’g’irlanishi kerak. Masalan: “mana bu qur'on bizga ana shu sun'atlarni o'rgatadi qoidalarni o'rgatadi hayot nima ekanligini bildiradi”, quydagi tarzda to’g’irlanishi kerak: “mana bu qur'on bizga ana shu sunnatlarni o'rgatadi. Qoidalarni o'rgatadi. Hayot nima ekanligini bildiradi.”\n- O'zbekcha so'zlar to'g'ri yozishing kerak. Masalan: "Ubay etdi", bu xato. To'g'ri yozilishi: "Ubay aytdi".\n- Javobing orasi boshqa birorta ham o'zingdan gap yozma, "Avvalo, keling, matnlarni birma-bir ko'rib chiqaylik", yoki: "Agar yana qandaydir savollaringiz yoki tuzatishlar bo'lsa, men doimo yordam berishga tayyorman", deb javob orasida umuman yozma. Shunchaki matnni yozib ber.\n\nMatn:\n`

export async function editTranscribed(googleText: string) {
	const result = await model.generateContent(`${prompt}${googleText}`)

	return result.response.text()
}
