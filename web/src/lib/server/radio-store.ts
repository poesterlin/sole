import { eq } from 'drizzle-orm';
import { db } from './db';
import { radioSessionsTable } from './schema';

export type RadioSession = typeof radioSessionsTable.$inferSelect;

export async function getRadioSession(queueId: string): Promise<RadioSession | null> {
	const [session] = await db
		.select()
		.from(radioSessionsTable)
		.where(eq(radioSessionsTable.queueId, queueId));
	return session ?? null;
}

export async function disableRadio(queueId: string, message: string | null = null): Promise<void> {
	await db
		.update(radioSessionsTable)
		.set({ enabled: false, message, updatedAt: new Date() })
		.where(eq(radioSessionsTable.queueId, queueId));
}
