import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

const mockQuery = vi.hoisted(() => vi.fn());
const mockRelease = vi.hoisted(() => vi.fn());
const mockAcquire = vi.hoisted(() => vi.fn());
const mockHash = vi.hoisted(() => vi.fn().mockResolvedValue('hashed-pw'));

vi.mock('../../../../dal/pool/PoolRegistry', () => ({
  PoolRegistry: vi.fn().mockImplementation(() => ({
    acquireMetadataConnection: mockAcquire,
  })),
}));

vi.mock('../../../../common/security/password.service', () => ({
  PasswordService: vi.fn().mockImplementation(() => ({
    hash: mockHash,
  })),
}));

import { AdminUsersService } from '../admin-users.service';
import { PoolRegistry } from '../../../../dal/pool/PoolRegistry';
import { PasswordService } from '../../../../common/security/password.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ROW = {
  id: 'user-uuid', name: 'Alice', email: 'alice@example.com',
  is_active: true, created_at: new Date().toISOString(), role: 'admin',
};

describe('AdminUsersService', () => {
  let service: AdminUsersService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAcquire.mockResolvedValue({ query: mockQuery, release: mockRelease });
    service = new AdminUsersService(
      new (PoolRegistry as any)(),
      new (PasswordService as any)(),
    );
  });

  describe('UUID validation', () => {
    it('throws BadRequestException for invalid tenantId in listUsers', async () => {
      await expect(service.listUsers('not-a-uuid')).rejects.toThrow(BadRequestException);
      expect(mockAcquire).not.toHaveBeenCalled(); // no DB connection opened
    });
  });

  describe('listUsers', () => {
    it('returns users with roles for a tenant', async () => {
      // withTenant calls: BEGIN, SET LOCAL, then seedRoles (1 query), then SELECT users
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // SET LOCAL
        .mockResolvedValueOnce({ rows: [] }) // seedRoles INSERT
        .mockResolvedValueOnce({ rows: [USER_ROW] }) // SELECT users
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      const result = await service.listUsers(TENANT_ID);
      expect(result[0].email).toBe('alice@example.com');
      expect(result[0].role).toBe('admin');
    });
  });

  describe('createUser', () => {
    it('hashes password and inserts user with role', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // SET LOCAL
        .mockResolvedValueOnce({ rows: [] }) // seedRoles
        .mockResolvedValueOnce({ rows: [{ id: 'user-uuid', name: 'Alice', email: 'alice@example.com', is_active: true, created_at: new Date().toISOString() }] }) // INSERT user
        .mockResolvedValueOnce({ rows: [{ id: 'role-uuid' }] }) // SELECT role
        .mockResolvedValueOnce({ rows: [] }) // INSERT user_role
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      const result = await service.createUser(TENANT_ID, {
        name: 'Alice', email: 'alice@example.com', password: 'pw', role: 'admin',
      });
      expect(mockHash).toHaveBeenCalledWith('pw');
      expect(result.email).toBe('alice@example.com');
      expect(result.role).toBe('admin');
    });

    it('throws ConflictException on duplicate email', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // SET LOCAL
        .mockResolvedValueOnce({ rows: [] }) // seedRoles
        .mockRejectedValueOnce({ code: '23505' }); // INSERT user throws

      await expect(
        service.createUser(TENANT_ID, { name: 'A', email: 'a@b.com', password: 'pw', role: 'admin' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('updateUser', () => {
    it('updates name and returns user', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // SET LOCAL
        .mockResolvedValueOnce({ rows: [{ id: 'user-uuid', name: 'Bob', email: 'alice@example.com', is_active: true, created_at: new Date().toISOString() }] }) // UPDATE
        .mockResolvedValueOnce({ rows: [{ role: 'admin' }] }) // fetch role
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      const result = await service.updateUser(TENANT_ID, 'user-uuid', { name: 'Bob' });
      expect(result.id).toBe('user-uuid');
    });

    it('throws NotFoundException when user not found', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // SET LOCAL
        .mockResolvedValueOnce({ rows: [] }) // UPDATE returns nothing
        .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

      await expect(
        service.updateUser(TENANT_ID, 'bad-id', { name: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('handles no-field update (select-only path)', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // SET LOCAL
        .mockResolvedValueOnce({ rows: [{ id: 'user-uuid', name: 'Alice', email: 'alice@example.com', is_active: true, created_at: new Date().toISOString() }] }) // SELECT
        .mockResolvedValueOnce({ rows: [{ role: 'admin' }] }) // fetch role
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      const result = await service.updateUser(TENANT_ID, 'user-uuid', {});
      expect(result.id).toBe('user-uuid');
    });
  });

  describe('setActive', () => {
    it('sets is_active on the user', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // SET LOCAL
        .mockResolvedValueOnce({ rows: [{ id: 'user-uuid', name: 'Alice', email: 'alice@example.com', is_active: false, created_at: new Date().toISOString() }] }) // UPDATE
        .mockResolvedValueOnce({ rows: [{ role: 'admin' }] }) // fetch role
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      const result = await service.setActive(TENANT_ID, 'user-uuid', false);
      expect(result.is_active).toBe(false);
    });
  });

  describe('deleteUser', () => {
    it('hard deletes the user', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // SET LOCAL
        .mockResolvedValueOnce({ rows: [{ id: 'user-uuid' }] }) // DELETE
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      await service.deleteUser(TENANT_ID, 'user-uuid');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM users'),
        expect.any(Array),
      );
    });

    it('throws NotFoundException when user not found', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // SET LOCAL
        .mockResolvedValueOnce({ rows: [] }) // DELETE returns nothing
        .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

      await expect(service.deleteUser(TENANT_ID, 'bad-id')).rejects.toThrow(NotFoundException);
    });
  });
});
