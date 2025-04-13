import { editEventService } from '@/services/edit/edit.service'

export async function pushEditEvent(
	jobId: string,
	content: string,
	completed = false,
	broadcast?: (content: string, completed: boolean) => void
) {
	await editEventService.create(jobId, content, completed)

	if (broadcast) {
		broadcast(content, completed)
	}
}
