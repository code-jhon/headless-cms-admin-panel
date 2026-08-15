import { Sidebar } from "@/components/layout/sidebar";
import { RealtimeProvider } from "@/lib/realtime/provider";
import { listSchemas } from "@/lib/queries";

/**
 * Admin shell. The schema list is fetched here on the server so every admin
 * page shares one query rather than each page refetching it.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: schemas, error } = await listSchemas();

  return (
    <RealtimeProvider>
      <div className="flex h-screen overflow-hidden">
        <Sidebar schemas={schemas} error={error} />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-5xl px-8 py-10">{children}</div>
        </main>
      </div>
    </RealtimeProvider>
  );
}
