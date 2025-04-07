import ytdl from '@distube/ytdl-core'

export async function getTitleDuration(url: string) {
	const info = await ytdl.getInfo(url)
	const title = info.videoDetails.title
	const totalDuration = parseFloat(info.videoDetails.lengthSeconds)

	if (isNaN(totalDuration) || totalDuration <= 0) {
		throw new Error('Could not determine valid video duration.')
	}
	if (!title) {
		throw new Error('Could not determine video title.')
	}

	return {
		title,
		totalDuration
	}
}
