import { apiFetch } from "@/lib/api";

export type CallRecord = {
  id: number;
  caller_name: string | null;
  order_text: string | null;
  reservation_date: string | null;
  reservation_time: string | null;
  number_of_people: number | null;
  created_at: string;
};

export type DashboardMetrics = {
  totalCalls: number;
  totalReservations: number;
  totalOrders: number;
  avgPartySize: number;
};

export async function fetchCallRecords(): Promise<CallRecord[]> {
  return apiFetch<CallRecord[]>("/records");
}

export async function fetchMetrics(): Promise<DashboardMetrics> {
  return apiFetch<DashboardMetrics>("/metrics");
}
