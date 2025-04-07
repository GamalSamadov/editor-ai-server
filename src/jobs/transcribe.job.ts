import ytdl from '@distube/ytdl-core'
import ffmpeg from 'fluent-ffmpeg'
import { performance } from 'perf_hooks'

import {
	convertToUzbekLatin,
	deleteGCSFile,
	editTranscribed,
	formatDuration,
	transcribeWithGoogle,
	uploadStreamToGCS
} from '@/jobs/helpers'
import { logger } from '@/lib/logger'
import { userSession } from '@/services/session/session.service'
import { transcriptService } from '@/services/transcript/transcript.service'

import { getTitleDuration, pushTranscriptionEvent } from './transcribe'

const delay = (ms: number) => new Promise(res => setTimeout(res, ms))

export async function runTranscriptionJob(
	jobId: string,
	sessionId: string,
	url: string,
	broadcast?: (content: string, completed: boolean) => void
) {
	const jobStartTime = performance.now()
	let audioUrl: string | null = null // Store the audio URL

	try {
		await transcriptService.running(jobId)

		logger.info(`Fetching video info for ${url}`)

		const requestOptions: ytdl.getInfoOptions = {
			requestOptions: {
				headers: {
					'User-Agent':
						'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'
				}
			}
		}

		const { title, totalDuration } = await getTitleDuration(url)
		await transcriptService.updateTitle(jobId, title)

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
		} catch (err: any) {
			logger.error('Failed to get video info or audio format:', err)
			await pushTranscriptionEvent(
				jobId,
				`Xatolik: Video ma'lumotlarini yoki audio formatini olib bo'lmadi. ${err.message || ''}`,
				true, // Mark as completed (with error)
				broadcast
			)
			await transcriptService.error(jobId)
			return // Stop the job
		}
		// ----------------------------------

		await pushTranscriptionEvent(
			jobId,
			'Ovoz yuklanmoqda',
			false,
			broadcast
		)
		await delay(500)

		const segmentDuration = 160 // seconds
		const numSegments = Math.ceil(totalDuration / segmentDuration)
		await pushTranscriptionEvent(
			jobId,
			`Ovoz ${numSegments} bo'lakka taqsimlanmoqda`,
			false,
			broadcast
		)
		await delay(500)

		// TRANSCRIPTION
		await pushTranscriptionEvent(
			jobId,
			`Matnga o'girish boshlandi`,
			false,
			broadcast
		)

		const editedTexts: (string | null)[] = [] // Allow null for failed segments
		let i = 0

		while (i < numSegments) {
			const segmentNumber = i + 1
			const segmentStartTime = i * segmentDuration
			const actualDuration = Math.min(
				segmentDuration,
				totalDuration - segmentStartTime
			)

			// Ensure actualDuration is positive, skip if calculation is off
			if (actualDuration <= 0) {
				logger.warn(
					`Skipping segment ${segmentNumber} due to zero or negative duration.`
				)
				i++ // Ensure loop progresses
				continue
			}

			const destFileName = `segment_${jobId}_${i}.mp3`
			let gcsUri: string | null = null // Track GCS URI for cleanup
			let segmentProcessingError = false // Flag to track segment errors

			try {
				logger.info(
					`Processing segment ${segmentNumber}/${numSegments}: StartTime=${segmentStartTime}s, Duration=${actualDuration}s`
				)

				// --- Use ffmpeg directly for streaming and seeking ---
				const ffmpegProc = ffmpeg(audioUrl) // Use the direct audio URL obtained earlier
					.setStartTime(segmentStartTime) // Seek to the start time
					.setDuration(actualDuration) // Process for this duration
					.format('mp3')
					.audioCodec('libmp3lame')
					.audioQuality(2) // Adjust quality as needed
					.on('error', (err, stdout, stderr) => {
						// Log detailed ffmpeg errors
						logger.error(
							`FFmpeg error processing segment ${segmentNumber}: ${err.message}`
						)
						logger.error(`FFmpeg stderr: ${stderr}`)
						// Note: Error here might need more robust handling, potentially throwing
						// to be caught by the outer try/catch. For now, log and proceed.
					})
				// ----------------------------------------------------

				// Upload the processed stream from ffmpeg
				gcsUri = await uploadStreamToGCS(
					ffmpegProc.pipe(),
					destFileName
				) // pipe() returns a Readable stream
				if (!gcsUri) {
					throw new Error('Failed to upload segment to GCS.')
				}
				logger.info(
					`Segment ${segmentNumber} uploaded to GCS: ${gcsUri}`
				)

				await pushTranscriptionEvent(
					jobId,
					`Google matnni o'girmoqda ${segmentNumber}/${numSegments}`,
					false,
					broadcast
				)

				// Attempt Transcription
				let transcriptGoogle = await transcribeWithGoogle(gcsUri)

				// Simple Retry Logic (Optional but Recommended)
				if (!transcriptGoogle) {
					logger.warn(
						`Google STT failed for segment ${segmentNumber}. Retrying once...`
					)
					await pushTranscriptionEvent(
						jobId,
						`${segmentNumber}/${numSegments}-chi Google matnida xatolik. Qayta urinish...`,
						false,
						broadcast
					)
					await delay(1000) // Wait before retry
					transcriptGoogle = await transcribeWithGoogle(gcsUri)
				}

				// Handle Transcription Failure
				if (!transcriptGoogle) {
					logger.error(
						`Google STT failed definitively for segment ${segmentNumber}.`
					)
					await pushTranscriptionEvent(
						jobId,
						`${segmentNumber}/${numSegments}-chi Google matni o'girilmadi!`,
						false,
						broadcast
					)
					segmentProcessingError = true // Mark segment as failed
					editedTexts.push(
						`[Xatolik: ${segmentNumber}-chi bo'lak matnga o'girilmadi]`
					)
				} else {
					// Attempt Editing
					await pushTranscriptionEvent(
						jobId,
						`Gemini tahrir qilmoqda ${segmentNumber}/${numSegments}`,
						false,
						broadcast
					)
					let finalText = await editTranscribed(transcriptGoogle)

					// Simple Retry Logic for Gemini (Optional)
					if (!finalText) {
						logger.warn(
							`Gemini editing failed for segment ${segmentNumber}. Retrying once...`
						)
						await pushTranscriptionEvent(
							jobId,
							`${segmentNumber}/${numSegments}-chi matn tahririda xatolik. Qayta urinish...`,
							false,
							broadcast
						)
						await delay(1000)
						finalText = await editTranscribed(transcriptGoogle) // Retry editing
					}

					// Handle Editing Failure
					if (finalText) {
						editedTexts.push(finalText)
						logger.info(
							`Segment ${segmentNumber} processed successfully.`
						)
						await pushTranscriptionEvent(
							jobId,
							`${segmentNumber}/${numSegments}-chi matn tayyor!`,
							false,
							broadcast
						)
					} else {
						logger.error(
							`Gemini editing failed definitively for segment ${segmentNumber}.`
						)
						await pushTranscriptionEvent(
							jobId,
							`Xatolik: ${segmentNumber}/${numSegments}-chi matn tahrir qilinmadi!`,
							false,
							broadcast
						)
						segmentProcessingError = true // Mark segment as failed
						editedTexts.push(
							`[Xatolik: ${segmentNumber}-chi bo'lak tahrir qilinmadi]`
						) // Add placeholder
					}
				}
			} catch (err: any) {
				logger.error(
					`Error processing segment ${segmentNumber}: ${err.message}`,
					err
				)
				await pushTranscriptionEvent(
					jobId,
					`Xatolik ${segmentNumber}/${numSegments}-chi bo'lakni qayta ishlashda: ${err.message}`,
					false,
					broadcast
				)
				segmentProcessingError = true // Mark segment as failed
				editedTexts.push(
					`[Xatolik: ${segmentNumber}-chi bo'lakda kutilmagan xatolik]`
				) // Add placeholder
				// We don't call transcriptService.error(jobId) here, let the job finish partially
			} finally {
				// --- Cleanup GCS File ---
				if (gcsUri) {
					if (!segmentProcessingError) {
						// Only announce deletion if segment was somewhat successful
						await pushTranscriptionEvent(
							jobId,
							`Ovoz o'chirilmoqda ${segmentNumber}/${numSegments}`,
							false,
							broadcast
						)
						await delay(200) // Short delay before deletion
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
				// --- ALWAYS INCREMENT 'i' ---
				i++
				// --------------------------
				await delay(500) // Small delay between segments
			}
		} // End while loop

		// Mark session complete (assuming each session has a single job to do)
		try {
			await userSession.completed(sessionId)
		} catch (err) {
			logger.warn(
				`Could not mark session as completed for sessionId=${sessionId}`,
				err
			)
		}

		await pushTranscriptionEvent(
			jobId,
			"Barcha bo'laklar qayta ishlandi. Matn jamlanmoqda...",
			false,
			broadcast
		)
		await delay(500)

		// Combine final results (filtering out nulls/error placeholders if desired, or keeping them)
		const combinedResult = editedTexts
			// .filter(text => text !== null && !text.startsWith('[Xatolik:')) // Option: Filter out errors
			.map(text => text ?? '') // Replace nulls with empty strings if keeping all
			.join('\n\n')
			.replace(/\(\(\((.*?)\)\)\)/g, '$1') // Your existing replacement

		const duration = performance.now() - jobStartTime

		await pushTranscriptionEvent(
			jobId,
			`Text jamlandi! Yakuniy formatlash...`,
			false,
			broadcast
		)
		await delay(500)

		const finalTranscript = `<i style="display: block; font-style: italic; text-align: center;">🕒 Arginalni yozib chiqish uchun: ${formatDuration(duration)} vaqt ketdi!</i><h1 style="font-weight: 700; font-size: 1.8rem; margin: 1rem 0; text-align: center; line-height: 1;">${title}</h1>\n\n<p style="text-indent: 30px;">${convertToUzbekLatin(combinedResult)}</p>`

		await transcriptService.saveFinalTranscript(jobId, finalTranscript)

		// Send final SSE event
		await pushTranscriptionEvent(jobId, finalTranscript, true, broadcast) // Mark as completed
	} catch (err: any) {
		logger.error('FATAL runTranscriptionJob error:', err)
		await transcriptService.error(jobId)
		// Send an error event if possible
		await pushTranscriptionEvent(
			jobId,
			`Kritik xatolik yuz berdi: ${err.message || "Noma'lum xatolik"}`,
			true, // Mark as completed (with error)
			broadcast
		)
	}
}
