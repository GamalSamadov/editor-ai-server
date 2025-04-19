import { Request, Response, Router } from 'express'

import { EDIT_PROMPT, TRANSCRIBE_EDIT_PROMPT } from '@/constants'
import { authenticate } from '@/middlewares/auth.middleware'
import { userSession } from '@/services/session/session.service'

const router = Router()

router.get(
	'/',
	authenticate,
	async (req: Request, res: Response): Promise<void> => {
		try {
			const sessions = await userSession.findAll()

			if (!sessions) {
				res.status(404).json({ message: 'Sessions not found' })
				return
			}

			res.status(200).json(sessions)
		} catch (error) {
			res.status(400).json({ message: error.message })
			return
		}
	}
)

router.post(
	'/start-transcribe',
	authenticate,
	async (req: Request, res: Response) => {
		const { url } = req.body as { url: string }

		if (!url) {
			res.status(400).json({ message: 'URL is required!' })
			return
		}

		const userId = req.user.id

		const sessionId = await userSession.createTranscript(userId)
		await userSession.updateURL(sessionId, url)
		await userSession.updatePrompt(sessionId, TRANSCRIBE_EDIT_PROMPT)

		res.json({ sessionId: sessionId })
	}
)

router.post(
	'/start-edit',
	authenticate,
	async (req: Request, res: Response) => {
		const { text, title } = req.body as {
			text: string
			title: string
		}

		if (!text) {
			res.status(400).json({ message: 'Text is required!' })
			return
		}

		if (!title) {
			res.status(400).json({ message: 'Title is required!' })
			return
		}

		const userId = req.user.id

		const sessionId = await userSession.createEdit(userId)

		await userSession.updateText(sessionId, text)
		await userSession.updateTitle(sessionId, title)
		await userSession.updatePrompt(sessionId, EDIT_PROMPT)

		res.json({ sessionId: sessionId })
	}
)

router.delete(
	'/:id',
	authenticate,
	async (req: Request, res: Response): Promise<void> => {
		try {
			const { id } = req.params

			const session = await userSession.delete(id)

			if (!session) {
				res.status(404).json({ message: 'Session not found' })
				return
			}

			res.status(200).json(session)
		} catch (error) {
			res.status(400).json({ message: error.message })
			return
		}
	}
)

export default router
