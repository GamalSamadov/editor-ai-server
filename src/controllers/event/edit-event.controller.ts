import { JobStatus, PrismaClient } from '@prisma/client'
import { Request, Response, Router } from 'express'

import { runEditJob } from '@/jobs/edit.job'
import { logger } from '@/lib/logger'
import { authenticate } from '@/middlewares/auth.middleware'

const router = Router()

const prisma = new PrismaClient()

const jobConnections = new Map<string, Response[]>()

router.get(
	'/:sessionId/find-all',
	authenticate,
	async (req: Request, res: Response) => {
		try {
			const { sessionId } = req.params

			const existingSession = await prisma.userSession.findUnique({
				where: { id: sessionId }
			})
			if (!existingSession) {
				res.status(404).json({ message: 'Session not found!' })
				return
			}

			const events = await prisma.event.findMany({
				where: {
					job: {
						session: {
							id: sessionId
						}
					}
				},
				orderBy: { createdAt: 'asc' }
			})

			res.json(events)
		} catch (error: any) {
			logger.error(error)
			res.status(500).json({ message: error.message })
		}
	}
)

router.get('/:sessionId', async (req: Request, res: Response) => {
	const { sessionId } = req.params

	try {
		const existingSession = await prisma.userSession.findUnique({
			where: { id: sessionId }
		})

		if (!existingSession) {
			res.status(404).json({ message: 'Session not found!' })
			return
		}

		let job = await prisma.job.findFirst({
			where: {
				session: {
					id: sessionId
				}
			}
		})

		if (!job) {
			job = await prisma.job.create({
				data: {
					status: JobStatus.PENDING,
					session: {
						connect: { id: sessionId }
					}
				}
			})

			void runEditJob(
				job.id,
				sessionId,

				async (content, completed) => {
					const connections = jobConnections.get(job!.id) || []
					if (connections.length) {
						const payload = {
							content,
							completed,
							createdAt: new Date().toISOString()
						}
						connections.forEach(resp => {
							resp.write(`data: ${JSON.stringify(payload)}\n\n`)
						})
					}
				}
			).catch(err => {
				console.error('Edit job error:', err)
			})
		}

		res.writeHead(200, {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		})

		if (!jobConnections.has(job.id)) {
			jobConnections.set(job.id, [])
		}
		jobConnections.get(job.id)?.push(res)

		const existingEvents = await prisma.event.findMany({
			where: { jobId: job.id },
			orderBy: { createdAt: 'asc' }
		})

		for (const evt of existingEvents) {
			const payload = {
				content: evt.content,
				completed: evt.completed,
				createdAt: evt.createdAt
			}
			res.write(`data: ${JSON.stringify(payload)}\n\n`)
		}

		req.on('close', () => {
			const list = jobConnections.get(job!.id)
			if (list) {
				jobConnections.set(
					job!.id,
					list.filter(r => r !== res)
				)
			}
		})
	} catch (error) {
		logger.error(error)
		res.status(500).json({ message: error.message })
	}
})

export default router
