import ytdl from '@distube/ytdl-core'
import ffmpeg from 'fluent-ffmpeg'
import { performance } from 'perf_hooks'

import {
	convertToUzbekLatin,
	delay,
	deleteGCSFile,
	editGemini,
	formatDuration,
	transcribeWithGoogle,
	uploadStreamToGCS
} from '@/jobs/helpers'
import { logger } from '@/lib/logger'
import { userSession } from '@/services/session/session.service'
import { transcriptService } from '@/services/transcript/transcript.service'

import { getTitleDuration, pushTranscribeEvent } from './transcribe'

const requestOptions: ytdl.getInfoOptions = {
	requestOptions: {
		headers: {
			'User-Agent':
				'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'
		}
	}
}

const SEGMENT_DURATION_SECONDS = 60 * 10

function createProgressBar(percent: number, width: number): string {
	const clampedPercent = Math.max(0, Math.min(100, percent)) // Ensure 0-100
	const filledWidth = Math.round((width * clampedPercent) / 100)
	const emptyWidth = width - filledWidth
	const filled = '█'.repeat(filledWidth)
	const empty = '░'.repeat(emptyWidth) // Using a different char for empty part
	// Or use: const empty = '-'.repeat(emptyWidth);
	return `[${filled}${empty}] ${clampedPercent}%`
}

export async function runTranscriptionJob(
	jobId: string,
	sessionId: string,
	broadcast?: (content: string, completed: boolean) => void
) {
	const jobStartTime = performance.now()
	let audioUrl: string | null = null

	const { url, prompt, id } = await userSession.findById(sessionId)

	try {
		await transcriptService.running(jobId)

		logger.info(`Fetching video info for ${url}`)

		const { title, totalDuration } = await getTitleDuration(url)

		try {
			const info = await ytdl.getInfo(url, requestOptions)
			const format = ytdl.chooseFormat(info.formats, {
				quality: 'highestaudio',
				filter: 'audioonly'
			})
			if (!format || !format.url) {
				throw new Error(
					'Could not find a suitable audio-only format for the video.'
				)
			}
			audioUrl = format.url
			logger.info(`Obtained direct audio URL.`)
			await userSession.updateTitle(id, title)
		} catch (err: any) {
			logger.error('Failed to get video info or audio format:', err)
			await pushTranscribeEvent(
				jobId,
				`Xatolik: Video ma'lumotlarini yoki audio formatini olib bo'lmadi. ${err.message || ''}`,
				true,
				broadcast
			)
			await transcriptService.error(jobId)
			return
		}

		await pushTranscribeEvent(jobId, 'Ovoz yuklanmoqda', false, broadcast)
		await delay(500)

		const segmentDuration = SEGMENT_DURATION_SECONDS
		const numSegments = Math.ceil(totalDuration / segmentDuration)
		await pushTranscribeEvent(
			jobId,
			`Ovoz ${numSegments} bo'lakka taqsimlanmoqda`,
			false,
			broadcast
		)
		await delay(500)

		// TRANSCRIPTION
		await pushTranscribeEvent(
			jobId,
			`Matnga o'girish boshlandi`,
			false,
			broadcast
		)

		const editedTexts: (string | null)[] = []
		let i = 0

		while (i < numSegments) {
			const segmentNumber = i + 1
			const segmentStartTime = i * segmentDuration
			const actualDuration = Math.min(
				segmentDuration,
				totalDuration - segmentStartTime
			)

			if (actualDuration <= 0) {
				logger.warn(
					`Skipping segment ${segmentNumber} due to zero or negative duration.`
				)
				i++
				continue
			}

			const destFileName = `segment_${jobId}_${i}.mp3`
			let gcsUri: string | null = null
			let segmentProcessingError = false

			try {
				logger.info(
					`Processing segment ${segmentNumber}/${numSegments}: StartTime=${segmentStartTime}s, Duration=${actualDuration}s`
				)

				const ffmpegProc = ffmpeg(audioUrl)
					.setStartTime(segmentStartTime)
					.setDuration(actualDuration)
					.format('mp3')
					.audioCodec('libmp3lame')
					.audioQuality(2)
					.on('error', (err, stdout, stderr) => {
						logger.error(
							`FFmpeg error processing segment ${segmentNumber}: ${err.message}`
						)
						logger.error(`FFmpeg stderr: ${stderr}`)
					})
					.on('progress', progress => {
						let lastReportedPercent = -1 // Keep track of the last reported percentage
						const reportThreshold = 5 // Report progress every 5% increment
						const progressBarWidth = 30 // Width of the text progress bar in logs
						// Ensure percent is a valid number before proceeding
						if (
							typeof progress.percent !== 'number' ||
							progress.percent < 0
						) {
							return // Ignore invalid progress data
						}

						const currentPercent = Math.round(progress.percent)

						// Throttle updates: Report only if it's the first update (0%),
						// crosses the threshold, or reaches 100%
						if (
							(currentPercent === 0 && lastReportedPercent < 0) || // Report 0%
							currentPercent >=
								lastReportedPercent + reportThreshold || // Report threshold increments
							(currentPercent === 100 &&
								lastReportedPercent < 100) // Always report 100%
						) {
							lastReportedPercent = currentPercent // Update last reported value

							// Log beautiful progress bar
							const progressBar = createProgressBar(
								currentPercent,
								progressBarWidth
							)
							logger.info(
								`Segment ${segmentNumber}/${numSegments} Progress: ${progressBar}`
							)

							// Push throttled, rounded event to UI/Client
							pushTranscribeEvent(
								jobId,
								// Using "qayta ishlanmoqda" (being processed)
								`Bo'lim ${segmentNumber}/${numSegments} qayta ishlanmoqda: ${currentPercent}%`,
								false,
								broadcast
							)
						}
					})

				gcsUri = await uploadStreamToGCS(
					ffmpegProc.pipe(),
					destFileName
				)
				if (!gcsUri) {
					throw new Error('Failed to upload segment to GCS.')
				}
				logger.info(
					`Segment ${segmentNumber} uploaded to GCS: ${gcsUri}`
				)

				await pushTranscribeEvent(
					jobId,
					`Google matnni o'girmoqda ${segmentNumber}/${numSegments}`,
					false,
					broadcast
				)

				let transcriptGoogle = await transcribeWithGoogle(gcsUri)

				if (!transcriptGoogle) {
					logger.warn(
						`Google STT failed for segment ${segmentNumber}. Retrying once...`
					)
					await pushTranscribeEvent(
						jobId,
						`${segmentNumber}/${numSegments}-chi Google matnida xatolik. Qayta urinish...`,
						false,
						broadcast
					)
					await delay(1000)
					transcriptGoogle = await transcribeWithGoogle(gcsUri)
				}

				if (!transcriptGoogle) {
					logger.error(
						`Google STT failed definitively for segment ${segmentNumber}.`
					)
					await pushTranscribeEvent(
						jobId,
						`${segmentNumber}/${numSegments}-chi Google matni o'girilmadi!`,
						false,
						broadcast
					)
					segmentProcessingError = true
					editedTexts.push(
						`[Xatolik: ${segmentNumber}-chi bo'lak matnga o'girilmadi]`
					)
				} else {
					await pushTranscribeEvent(
						jobId,
						`Gemini tahrir qilmoqda ${segmentNumber}/${numSegments}`,
						false,
						broadcast
					)
					let finalText = await editGemini(transcriptGoogle, prompt)

					if (!finalText) {
						logger.warn(
							`Gemini editing failed for segment ${segmentNumber}. Retrying once...`
						)
						await pushTranscribeEvent(
							jobId,
							`${segmentNumber}/${numSegments}-chi matn tahririda xatolik. Qayta urinish...`,
							false,
							broadcast
						)
						await delay(1000)
						finalText = await editGemini(transcriptGoogle, prompt)
					}

					if (finalText) {
						editedTexts.push(finalText)
						logger.info(
							`Segment ${segmentNumber} processed successfully.`
						)
						await pushTranscribeEvent(
							jobId,
							`${segmentNumber}/${numSegments}-chi matn tayyor!`,
							false,
							broadcast
						)
					} else {
						logger.error(
							`Gemini editing failed definitively for segment ${segmentNumber}.`
						)
						await pushTranscribeEvent(
							jobId,
							`Xatolik: ${segmentNumber}/${numSegments}-chi matn tahrir qilinmadi!`,
							false,
							broadcast
						)
						segmentProcessingError = true
						editedTexts.push(
							`[Xatolik: ${segmentNumber}-chi bo'lak tahrir qilinmadi]`
						)
					}
				}
			} catch (err: any) {
				logger.error(
					`Error processing segment ${segmentNumber}: ${err.message}`,
					err
				)
				await pushTranscribeEvent(
					jobId,
					`Xatolik ${segmentNumber}/${numSegments}-chi bo'lakni qayta ishlashda: ${err.message}`,
					false,
					broadcast
				)
				segmentProcessingError = true
				editedTexts.push(
					`[Xatolik: ${segmentNumber}-chi bo'lakda kutilmagan xatolik]`
				)
			} finally {
				if (gcsUri) {
					if (!segmentProcessingError) {
						await pushTranscribeEvent(
							jobId,
							`Ovoz o'chirilmoqda ${segmentNumber}/${numSegments}`,
							false,
							broadcast
						)
						await delay(200)
					}
					try {
						await deleteGCSFile(gcsUri)
						logger.info(
							`Deleted GCS file for segment ${segmentNumber}: ${gcsUri}`
						)
					} catch (deleteErr) {
						logger.error(
							`Failed to delete GCS file ${gcsUri}:`,
							deleteErr
						)
					}
				}
				i++
				await delay(500)
			}
		}

		try {
			await userSession.completed(sessionId)
		} catch (err) {
			logger.warn(
				`Could not mark session as completed for sessionId=${sessionId}`,
				err
			)
		}

		await pushTranscribeEvent(
			jobId,
			"Barcha bo'laklar qayta ishlandi. Matn jamlanmoqda...",
			false,
			broadcast
		)
		await delay(500)

		const combinedResult = editedTexts
			// .filter(text => text !== null && !text.startsWith('[Xatolik:')) // Option: Filter out errors
			.map(text => text ?? '')
			.join('\n\n')
			.replace(/\(\(\((.*?)\)\)\)/g, '$1')

		const duration = performance.now() - jobStartTime

		await pushTranscribeEvent(
			jobId,
			`Text jamlandi! Yakuniy formatlash...`,
			false,
			broadcast
		)
		await delay(500)

		const finalTranscript = `<i style="display: block; font-style: italic; text-align: center;">🕒 Arginalni yozib chiqish uchun: ${formatDuration(duration)} vaqt ketdi!</i><h1 style="font-weight: 700; font-size: 1.8rem; margin: 1rem 0; text-align: center; line-height: 1;">${title}</h1>\n\n<p style="text-indent: 30px;">${convertToUzbekLatin(combinedResult)}</p>`

		await transcriptService.saveFinalTranscript(jobId, finalTranscript)

		// Send final SSE event
		await pushTranscribeEvent(jobId, finalTranscript, true, broadcast) // Mark as completed
	} catch (err: any) {
		logger.error('FATAL runTranscriptionJob error:', err)
		await transcriptService.error(jobId)
		await pushTranscribeEvent(
			jobId,
			`Kritik xatolik yuz berdi: ${err.message || "Noma'lum xatolik"}`,
			true,
			broadcast
		)
	}
}
