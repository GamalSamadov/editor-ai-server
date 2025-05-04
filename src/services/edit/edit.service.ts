import { JobStatus, PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

class EditService {
	public async getAll() {
		return await prisma.job.findMany({
			include: {
				session: true
			}
		})
	}

	public async delete(id: string) {
		return await prisma.job.delete({
			where: {
				id
			}
		})
	}

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

	public async saveFinalText(jobId: string, finalText: string) {
		return await prisma.job.update({
			where: { id: jobId },
			data: {
				status: JobStatus.COMPLETED,
				finalText
			}
		})
	}
}

class EditEventService {
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

export const editService = new EditService()
export const editEventService = new EditEventService()
