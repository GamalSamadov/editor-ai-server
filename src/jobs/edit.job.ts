import { performance } from 'perf_hooks'

import { editService } from '@/services/edit/edit.service'
import { userSession } from '@/services/session/session.service'

import { pushEditEvent } from './edit'
import {
	delay,
	editGemini,
	formatDuration,
	splitStringByWordCount
} from './helpers'

const SPLIT_WORD_COUNT = 1000

export async function runEditJob(
	jobId: string,
	sessionId: string,

	broadcast?: (content: string, completed: boolean) => void
) {
	const { text, prompt, title } = await userSession.findById(sessionId)
	const jobStartTime = performance.now()
	const finalTextArray: string[] = []

	try {
		await editService.running(jobId)

		const splittedText = splitStringByWordCount(text, SPLIT_WORD_COUNT)

		await pushEditEvent(
			jobId,
			`Matn tahrirlanmoqda... (${splittedText.length} ta bo'lak)`,
			false,
			broadcast
		)

		await delay(500)

		for (const index in splittedText) {
			const chunk = splittedText[index]

			await pushEditEvent(
				jobId,
				`Matn tahrirlanmoqda... (${Number(index) + 1}/${
					splittedText.length
				})`,
				false,
				broadcast
			)

			let editedText = await editGemini(chunk, prompt)

			while (!editedText) {
				await pushEditEvent(
					jobId,
					`Matn tahrirlanmoqda... (${Number(index) + 1}/${
						splittedText.length
					}). Qayta urinish...`,
					false,
					broadcast
				)

				await delay(1000)

				editedText = await editGemini(chunk, prompt)
			}

			if (!editedText) {
				throw new Error('Gemini tahrir qilish muvaffaqiyatsiz tugadi.')
			}
			finalTextArray.push(editedText)
			await delay(500)
		}

		try {
			await userSession.completed(sessionId)
		} catch (err) {
			await pushEditEvent(
				jobId,
				`Kutilmagan xatolik: ${err}`,
				true,
				broadcast
			)
		}

		await pushEditEvent(jobId, `Matn jamlanmoqda...`, false, broadcast)

		const combinedResult = finalTextArray
			.map(text => text ?? '')
			.join('\n\n')
			.replace(/\(\(\((.*?)\)\)\)/g, '$1')

		await pushEditEvent(
			jobId,
			`Text jamlandi! Yakuniy formatlash...`,
			false,
			broadcast
		)
		await delay(500)

		const duration = performance.now() - jobStartTime

		const finalText = `<i style="display: block; font-style: italic; text-align: center;">🕒 Matnni tahrirlab chiqish uchun: ${formatDuration(duration)} vaqt ketdi!</i><h1 style="font-weight: 700; font-size: 1.8rem; margin: 1rem 0; text-align: center; line-height: 1;">${title}</h1>\n\n<p style="text-indent: 30px;">${combinedResult}</p>`

		await editService.saveFinalText(jobId, finalText)

		await pushEditEvent(jobId, finalText, true, broadcast) // Final success message
	} catch (error) {
		await editService.error(jobId)
		await pushEditEvent(
			jobId,
			`Xatolik: ${error.message || ''}`,
			true,
			broadcast
		)
	}
}
