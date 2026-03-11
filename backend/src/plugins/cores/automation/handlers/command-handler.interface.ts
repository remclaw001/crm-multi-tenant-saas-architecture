export interface ActionCommandContext {
  tenantId: string;
  eventId: string;
  triggerId: string;
  triggerContext: Record<string, unknown>;
}

export interface CommandHandler<TParams = Record<string, unknown>> {
  readonly actionType: string;
  execute(ctx: ActionCommandContext, params: TParams): Promise<void>;
}
