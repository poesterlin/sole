// Queue mutations and radio refills share a lock in the single web process.
const pending = new Map<string, Promise<unknown>>();

export async function withPlaybackLock<T>(
	queueId: string,
	operation: () => Promise<T>
): Promise<T> {
	const previous = pending.get(queueId) ?? Promise.resolve();
	const current = previous.catch(() => {}).then(operation);
	pending.set(queueId, current);
	try {
		return await current;
	} finally {
		if (pending.get(queueId) === current) pending.delete(queueId);
	}
}
