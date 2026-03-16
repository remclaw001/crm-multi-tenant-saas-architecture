import type { z } from 'zod';

export interface EventDefinition<T extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  plugin: string;
  description: string;
  schema: T;
}
