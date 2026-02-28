'use client';

// This component is also exposed as a Module Federation REMOTE module
// (see next.config.ts exposes). Any MF HOST can lazy-load it:
//   const ContactsList = React.lazy(() => import('web/ContactsList'));

import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { useState } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import type { Contact } from '@/types/api.types';

const STATUS_COLOR: Record<Contact['status'], string> = {
  lead: 'bg-sky-100 text-sky-700',
  prospect: 'bg-violet-100 text-violet-700',
  customer: 'bg-green-100 text-green-700',
  churned: 'bg-slate-100 text-slate-600',
};

const columns: ColumnDef<Contact>[] = [
  {
    accessorFn: (row) => `${row.firstName} ${row.lastName}`,
    id: 'name',
    header: ({ column }) => (
      <button onClick={() => column.toggleSorting()} className="flex items-center gap-1 font-medium">
        Name
        {column.getIsSorted() === 'asc' ? <ArrowUp className="h-3 w-3" /> : column.getIsSorted() === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUpDown className="h-3 w-3 opacity-40" />}
      </button>
    ),
    cell: ({ row, getValue }) => (
      <div>
        <p className="font-medium">{getValue<string>()}</p>
        <p className="text-xs text-muted-foreground">{row.original.email}</p>
      </div>
    ),
  },
  {
    accessorKey: 'company',
    header: 'Company',
    cell: ({ getValue }) => getValue<string>() ?? '—',
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ getValue }) => {
      const s = getValue<Contact['status']>();
      return (
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[s]}`}>
          {s}
        </span>
      );
    },
  },
  {
    accessorKey: 'phone',
    header: 'Phone',
    cell: ({ getValue }) => getValue<string>() ?? '—',
  },
];

interface ContactsListProps {
  contacts: Contact[];
}

export function ContactsList({ contacts }: ContactsListProps) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable({
    data: contacts,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-border bg-muted/30">
                {hg.headers.map((h) => (
                  <th key={h.id} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-b border-border transition-colors last:border-0 hover:bg-muted/50">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-3">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {contacts.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-muted-foreground">
                  No contacts found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
