export interface ActionParamSchema {
  name: string;
  label: string;
  type: 'string' | 'url' | 'enum' | 'template-string';
  required: boolean;
  options?: { value: string; label: string }[];
  hint?: string;
}

export interface ActionDefinition {
  type: string;
  label: string;
  description: string;
  requiredPlugins: string[];
  params: ActionParamSchema[];
}

export const ACTION_CATALOG: ActionDefinition[] = [
  {
    type: 'webhook.call',
    label: 'Call Webhook',
    description: 'Send an HTTP request to an external URL.',
    requiredPlugins: [],
    params: [
      { name: 'url', label: 'URL', type: 'url', required: true, hint: 'https://example.com/webhook' },
      {
        name: 'method',
        label: 'Method',
        type: 'enum',
        required: true,
        options: [
          { value: 'POST', label: 'POST' },
          { value: 'GET',  label: 'GET'  },
          { value: 'PUT',  label: 'PUT'  },
        ],
      },
      {
        name: 'body',
        label: 'Body',
        type: 'template-string',
        required: false,
        hint: '{"customer": "{{customer.name}}"}',
      },
    ],
  },
  {
    type: 'customer.update_field',
    label: 'Update Customer Field',
    description: 'Update a field on the customer that triggered this event.',
    requiredPlugins: ['customer-data'],
    params: [
      {
        name: 'field',
        label: 'Field',
        type: 'enum',
        required: true,
        options: [
          { value: 'name',    label: 'Name'    },
          { value: 'email',   label: 'Email'   },
          { value: 'phone',   label: 'Phone'   },
          { value: 'company', label: 'Company' },
        ],
      },
      {
        name: 'value',
        label: 'Value',
        type: 'template-string',
        required: true,
        hint: '{{customer.name}}',
      },
    ],
  },
  {
    type: 'case.create',
    label: 'Create Support Case',
    description: 'Open a support case linked to the triggering customer.',
    requiredPlugins: ['customer-care'],
    params: [
      { name: 'title', label: 'Title', type: 'template-string', required: true, hint: 'Welcome — {{customer.name}}' },
      {
        name: 'priority',
        label: 'Priority',
        type: 'enum',
        required: true,
        options: [
          { value: 'low',    label: 'Low'    },
          { value: 'medium', label: 'Medium' },
          { value: 'high',   label: 'High'   },
        ],
      },
      { name: 'description', label: 'Description', type: 'template-string', required: false, hint: 'Customer email: {{customer.email}}' },
    ],
  },
];

export function getAvailableActions(enabledPlugins: string[]): ActionDefinition[] {
  return ACTION_CATALOG.filter((def) =>
    def.requiredPlugins.every((p) => enabledPlugins.includes(p)),
  );
}
