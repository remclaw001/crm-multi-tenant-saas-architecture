/** BullMQ queue names — single source of truth. */
export const QUEUE_EMAIL              = 'email-notifications'  as const;
export const QUEUE_WEBHOOK            = 'webhook-delivery'     as const;
export const QUEUE_VIP_MIGRATION      = 'vip-migration'        as const;
export const QUEUE_VIP_DECOMMISSION   = 'vip-decommission'     as const;
export const QUEUE_DATA_EXPORT        = 'data-export'          as const;
export const QUEUE_VIP_SHARED_CLEANUP = 'vip-shared-cleanup'   as const;
export const QUEUE_PLUGIN_INIT        = 'plugin-init'          as const;
export const QUEUE_PLUGIN_EVENTS      = 'plugin-events'         as const;
export const QUEUE_AUTOMATION_ACTIONS = 'automation-actions'    as const;
