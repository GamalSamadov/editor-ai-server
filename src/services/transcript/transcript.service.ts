import { JobStatus, PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

class TranscriptService {
	public async running(jobId: string) {
		return await prisma.job.update({
			where: { id: jobId },
			data: { status: JobStatus.RUNNING }
		})
	}

	public async completed(jobId: string) {
		return await prisma.job.update({
			where: { id: jobId },
			data: { status: JobStatus.COMPLETED }
		})
	}

	public async error(jobId: string) {
		return await prisma.job.update({
			where: { id: jobId },
			data: { status: JobStatus.ERROR }
		})
	}

	public async saveFinalTranscript(jobId: string, finalText: string) {
		return await prisma.job.update({
			where: { id: jobId },
			data: {
				status: JobStatus.COMPLETED,
				finalText
			}
		})
	}
}

class TranscriptEventService {
	public async create(jobId: string, content: string, completed: boolean) {
		return await prisma.event.create({
			data: {
				jobId,
				content,
				completed
			}
		})
	}
}

export const transcriptService = new TranscriptService()
export const transcriptEventService = new TranscriptEventService()
