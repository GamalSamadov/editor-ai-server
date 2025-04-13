import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

class SessionService {
	public async create(userId: string): Promise<string> {
		const session = await prisma.userSession.create({
			data: {
				user: {
					connect: {
						id: userId
					}
				}
			}
		})

		return session.id
	}

	public async updateURL(id: string, url: string) {
		await prisma.userSession.update({
			where: { id },
			data: { url }
		})
		return true
	}

	public async updateText(id: string, text: string) {
		await prisma.userSession.update({
			where: { id },
			data: { text }
		})
		return true
	}

	public async updatePrompt(id: string, prompt: string) {
		await prisma.userSession.update({
			where: { id },
			data: { prompt }
		})

		return true
	}

	public async updateTitle(id: string, title: string) {
		await prisma.userSession.update({
			where: { id },
			data: { title }
		})

		return true
	}

	public async completed(id: string) {
		await prisma.userSession.update({
			where: { id },
			data: { completed: true }
		})

		return true
	}

	public async findById(id: string) {
		const session = await prisma.userSession.findUnique({
			where: { id }
		})

		return session
	}
}

export const userSession = new SessionService()
