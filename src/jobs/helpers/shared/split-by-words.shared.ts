export function splitStringByWordCount(
	longString: string,
	wordsPerSegment: number = 1000
): string[] {
	if (typeof longString !== 'string' || longString === null) {
		console.warn("Input 'longString' must be a non-null string.")
		return []
	}

	if (
		typeof wordsPerSegment !== 'number' ||
		!Number.isInteger(wordsPerSegment) ||
		wordsPerSegment <= 0
	) {
		throw new Error(
			`'wordsPerSegment' must be a positive integer. Received: ${wordsPerSegment}`
		)
	}

	const words: string[] = longString.split(/\s+/).filter(Boolean)

	if (words.length === 0) {
		return []
	}

	const segments: string[] = []

	for (let i = 0; i < words.length; i += wordsPerSegment) {
		const wordChunk: string[] = words.slice(i, i + wordsPerSegment)

		const segment: string = wordChunk.join(' ')

		segments.push(segment)
	}

	return segments
}
