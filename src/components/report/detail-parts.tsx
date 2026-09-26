// Server-rendered building blocks for the owner-only report detail pages.

export function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <dt className="text-gray-500">{label}</dt>
      <dd className="whitespace-pre-wrap break-words">{value || "-"}</dd>
    </>
  );
}

export function DetailImage({ src, alt }: { src: string | null; alt: string }) {
  if (!src) return <span className="text-gray-400">ไม่มีรูป</span>;
  // eslint-disable-next-line @next/next/no-img-element -- Supabase storage URL (public or short-lived signed)
  return <img src={src} alt={alt} className="max-h-60 w-auto rounded-md border object-contain" />;
}

export function PublicCard({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-lg bg-white p-6 shadow-sm">
      <h2 className="text-sm font-semibold text-cdti-700">ข้อมูลสาธารณะ (แสดงในประกาศ)</h2>
      <dl className="mt-3 grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-sm">{children}</dl>
    </section>
  );
}

export function PrivateCard({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-lg border-2 border-amber-300 bg-amber-50 p-6">
      <h2 className="text-sm font-semibold text-amber-800">ข้อมูลลับ — เห็นเฉพาะคุณและเจ้าหน้าที่</h2>
      <dl className="mt-3 grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-sm">{children}</dl>
    </section>
  );
}
