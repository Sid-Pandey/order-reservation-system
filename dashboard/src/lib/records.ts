import path from "node:path";
import sqlite3 from "sqlite3";

export type CallRecord = {
  id: number;
  caller_name: string | null;
  order_text: string | null;
  reservation_date: string | null;
  reservation_time: string | null;
  number_of_people: number | null;
  created_at: string;
};

type DashboardMetrics = {
  totalCalls: number;
  totalReservations: number;
  totalOrders: number;
  avgPartySize: number;
};

function dbPath() {
  return path.join(process.cwd(), "..", "data.db");
}

function all<T>(sql: string, params: unknown[] = []) {
  return new Promise<T[]>((resolve, reject) => {
    const db = new sqlite3.Database(dbPath(), sqlite3.OPEN_READONLY, (openError) => {
      if (openError) reject(openError);
    });
    db.all(sql, params, (error, rows) => {
      db.close();
      if (error) return reject(error);
      resolve((rows as T[]) ?? []);
    });
  });
}

function get<T>(sql: string, params: unknown[] = []) {
  return new Promise<T | null>((resolve, reject) => {
    const db = new sqlite3.Database(dbPath(), sqlite3.OPEN_READONLY, (openError) => {
      if (openError) reject(openError);
    });
    db.get(sql, params, (error, row) => {
      db.close();
      if (error) return reject(error);
      resolve((row as T) ?? null);
    });
  });
}

export async function fetchCallRecords(): Promise<CallRecord[]> {
  try {
    return await all<CallRecord>(`
      SELECT id, caller_name, order_text, reservation_date, reservation_time, number_of_people, created_at
      FROM call_records
      ORDER BY created_at DESC
    `);
  } catch {
    return [];
  }
}

export async function fetchMetrics(): Promise<DashboardMetrics> {
  try {
    const row = await get<{
      total_calls: number;
      total_reservations: number;
      total_orders: number;
      avg_party_size: number | null;
    }>(`
      SELECT
        COUNT(*) AS total_calls,
        SUM(CASE WHEN reservation_date IS NOT NULL OR reservation_time IS NOT NULL THEN 1 ELSE 0 END) AS total_reservations,
        SUM(CASE WHEN order_text IS NOT NULL THEN 1 ELSE 0 END) AS total_orders,
        AVG(number_of_people) AS avg_party_size
      FROM call_records
    `);

    return {
      totalCalls: Number(row?.total_calls ?? 0),
      totalReservations: Number(row?.total_reservations ?? 0),
      totalOrders: Number(row?.total_orders ?? 0),
      avgPartySize: Number(row?.avg_party_size ?? 0),
    };
  } catch {
    return { totalCalls: 0, totalReservations: 0, totalOrders: 0, avgPartySize: 0 };
  }
}
