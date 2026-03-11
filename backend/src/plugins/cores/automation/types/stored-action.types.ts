export interface BaseStoredAction<
  TType extends string,
  TParams extends Record<string, unknown>,
> {
  type: TType;
  params: TParams;
}

export type WebhookCallAction = BaseStoredAction<
  'webhook.call',
  { url: string; method: 'GET' | 'POST' | 'PUT'; body?: string }
>;

export type CustomerUpdateFieldAction = BaseStoredAction<
  'customer.update_field',
  { field: string; value: string }
>;

export type CaseCreateAction = BaseStoredAction<
  'case.create',
  { title: string; priority: 'low' | 'medium' | 'high'; description?: string }
>;

export type KnownStoredAction =
  | WebhookCallAction
  | CustomerUpdateFieldAction
  | CaseCreateAction;

/** Extensible: allows future action types added by plugins. */
export type StoredAction =
  | KnownStoredAction
  | BaseStoredAction<string, Record<string, unknown>>;
