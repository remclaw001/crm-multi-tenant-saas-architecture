// ============================================================
// SearchIndexMessage — published to `search.index` exchange.
// SearchIndexConsumer pushes documents to Elasticsearch.
// ============================================================

export type SearchOperation = 'index' | 'update' | 'delete';

export interface SearchIndexMessage {
  tenantId: string;
  operation: SearchOperation;
  /** Elasticsearch index name: 'contacts', 'deals', 'activities'. */
  index: string;
  documentId: string;
  /** Full document (required for 'index'/'update', omitted for 'delete'). */
  document?: Record<string, unknown>;
}
