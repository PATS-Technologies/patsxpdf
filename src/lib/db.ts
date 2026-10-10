import "server-only";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

const globalForDb = globalThis as unknown as { pdfPool?: Pool };

export const pool = globalForDb.pdfPool ?? new Pool({
  connectionString: process.env.DATABASE_URL,
  options: "-c search_path=patsxpdf",
  max: 10,
});

if (process.env.NODE_ENV !== "production") globalForDb.pdfPool = pool;

export async function query<T extends QueryResultRow>(text: string, values: unknown[] = []) {
  return pool.query<T>(text, values);
}

export async function transaction<T>(callback: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
