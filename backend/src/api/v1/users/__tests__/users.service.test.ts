import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSelect = vi.hoisted(() => vi.fn());
const mockKnex = vi.hoisted(() => vi.fn().mockReturnValue({ select: mockSelect }));

vi.mock('knex', () => ({ default: mockKnex }));

import { UsersService } from '../users.service';

describe('UsersService.list', () => {
  let service: UsersService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new UsersService(mockKnex as any);
  });

  it('queries users table for id, name, email', async () => {
    const rows = [
      { id: 'u1', name: 'Alice', email: 'alice@acme.com' },
      { id: 'u2', name: 'Bob', email: 'bob@acme.com' },
    ];
    mockSelect.mockResolvedValue(rows);

    const result = await service.list();

    expect(mockKnex).toHaveBeenCalledWith('users');
    expect(mockSelect).toHaveBeenCalledWith('id', 'name', 'email');
    expect(result).toEqual(rows);
  });

  it('returns empty array when no users exist', async () => {
    mockSelect.mockResolvedValue([]);
    const result = await service.list();
    expect(result).toEqual([]);
  });
});
