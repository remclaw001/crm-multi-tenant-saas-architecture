// Load .env trước khi import bất cứ thứ gì khác
import 'dotenv/config';
import type { Knex } from 'knex';
import { config } from './src/config/env';

const knexConfig: Knex.Config = {
  client: 'postgresql',

  connection: config.DATABASE_URL,

  pool: {
    min: 2,
    max: config.DATABASE_POOL_MAX,
    // Đặt app.tenant_id về NULL sau khi connection trả về pool
    // Quan trọng: tránh context leak giữa các request
    afterCreate(conn: { query: (sql: string, cb: (err: Error | null) => void) => void }, done: (err: Error | null, conn: unknown) => void) {
      conn.query("SELECT set_config('app.tenant_id', NULL, false)", (err) => {
        done(err, conn);
      });
    },
  },

  migrations: {
    directory: './src/db/migrations',
    extension: 'ts',
    tableName: 'knex_migrations',
  },

  seeds: {
    directory: './src/db/seeds',
    extension: 'ts',
  },
};

export default knexConfig;
