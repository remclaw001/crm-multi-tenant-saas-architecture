// ============================================================
// Bull Board setup — queue monitoring UI at /admin/queues
//
// Usage in main.ts (after NestFactory.create):
//   const adapter = createBullBoardAdapter(app);
//   app.use('/admin/queues', adapter.getRouter());
//
// In dev: visit http://localhost:3000/admin/queues
// Secured in production by adding an auth guard / API key check.
// ============================================================
import { createBullBoard }      from '@bull-board/api';
import { BullMQAdapter }        from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter }       from '@bull-board/express';
import type { Queue }           from 'bullmq';

export function createBullBoardRouter(
  emailQueue:        Queue,
  webhookQueue:      Queue,
  pluginEventsQueue: Queue,
): ReturnType<typeof ExpressAdapter.prototype.getRouter> {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/admin/queues');

  createBullBoard({
    queues: [
      new BullMQAdapter(emailQueue),
      new BullMQAdapter(webhookQueue),
      new BullMQAdapter(pluginEventsQueue),
    ],
    serverAdapter,
  });

  return serverAdapter.getRouter();
}
