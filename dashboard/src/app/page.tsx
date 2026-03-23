import { fetchCallRecords, fetchMetrics } from "@/lib/records";

export const dynamic = "force-dynamic";

function formatCreatedAt(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function valueOrDash(value: string | number | null) {
  return value === null || value === "" ? "—" : String(value);
}

export default async function Home() {
  let records: Awaited<ReturnType<typeof fetchCallRecords>> = [];
  let metrics: Awaited<ReturnType<typeof fetchMetrics>> = {
    totalCalls: 0,
    totalReservations: 0,
    totalOrders: 0,
    avgPartySize: 0,
  };
  let hasApiError = false;

  try {
    [records, metrics] = await Promise.all([fetchCallRecords(), fetchMetrics()]);
  } catch {
    hasApiError = true;
  }

  return (
    <div className="min-h-screen px-6 py-8 text-[var(--foreground)] md:px-10 lg:px-14">
      <main className="mx-auto flex w-full max-w-7 flex-col gap-6">
        <header className="soft-card p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-[var(--muted)]">HostDesk Operations</p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight">Calls, Orders, Reservations</h1>
              <p className="mt-2 text-sm text-[var(--muted)]">
                AI phone assistant activity for front-of-house operations.
              </p>
            </div>
            <span className="badge bg-[var(--accent)]/10 text-[var(--accent)] border-[var(--accent)]/20">
              Live intake
            </span>
          </div>
        </header>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <article className="soft-card p-5">
            <p className="text-sm text-[var(--muted)]">Total Calls</p>
            <p className="mt-3 text-3xl font-semibold">{metrics.totalCalls}</p>
          </article>
          <article className="soft-card p-5">
            <p className="text-sm text-[var(--muted)]">Reservations Captured</p>
            <p className="mt-3 text-3xl font-semibold text-[var(--accent)]">{metrics.totalReservations}</p>
          </article>
          <article className="soft-card p-5">
            <p className="text-sm text-[var(--muted)]">Orders Captured</p>
            <p className="mt-3 text-3xl font-semibold text-[var(--gold)]">{metrics.totalOrders}</p>
          </article>
          <article className="soft-card p-5">
            <p className="text-sm text-[var(--muted)]">Avg Party Size</p>
            <p className="mt-3 text-3xl font-semibold">{metrics.avgPartySize.toFixed(1)}</p>
          </article>
        </section>

        <section className="soft-card overflow-hidden">
          <div className="border-b border-[var(--border)] px-6 py-4">
            <h2 className="text-lg font-semibold">Call Records</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Structured data extracted from AI-assisted customer calls.
            </p>
            {hasApiError ? (
              <p className="mt-2 text-sm text-[var(--danger)]">
                Could not load data from the API. Check `NEXT_PUBLIC_API_URL` and API availability.
              </p>
            ) : null}
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse">
              <thead>
                <tr className="bg-[#fbfaf7] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                  <th className="px-6 py-3 font-semibold">Created</th>
                  <th className="px-6 py-3 font-semibold">Caller</th>
                  <th className="px-6 py-3 font-semibold">Order</th>
                  <th className="px-6 py-3 font-semibold">Reservation Date</th>
                  <th className="px-6 py-3 font-semibold">Reservation Time</th>
                  <th className="px-6 py-3 font-semibold">People</th>
                </tr>
              </thead>
              <tbody>
                {records.length === 0 ? (
                  <tr>
                    <td className="px-6 py-12 text-center text-sm text-[var(--muted)]" colSpan={6}>
                      No call records yet. Once webhooks are received, records will appear here.
                    </td>
                  </tr>
                ) : (
                  records.map((record) => (
                    <tr key={record.id} className="border-t border-[var(--border)] text-sm">
                      <td className="px-6 py-4 whitespace-nowrap">{formatCreatedAt(record.created_at)}</td>
                      <td className="px-6 py-4 whitespace-nowrap font-medium">
                        {valueOrDash(record.caller_name)}
                      </td>
                      <td className="px-6 py-4 max-w-[480px]">
                        <p className="line-clamp-2">{valueOrDash(record.order_text)}</p>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">{valueOrDash(record.reservation_date)}</td>
                      <td className="px-6 py-4 whitespace-nowrap">{valueOrDash(record.reservation_time)}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {record.number_of_people ? (
                          <span className="badge bg-[#fff7ed] text-[var(--danger)] border-[#f5d6c4]">
                            {record.number_of_people}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
