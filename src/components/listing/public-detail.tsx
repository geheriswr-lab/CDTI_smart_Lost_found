import Link from "next/link";

export function PublicDetail({
  backHref,
  backLabel,
  title,
  imageSrc,
  rows,
  description,
  children,
}: {
  backHref: string;
  backLabel: string;
  title: string;
  imageSrc: string | null;
  rows: { label: string; value: string | null }[];
  description: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <Link href={backHref} className="text-sm text-cdti-600 hover:underline">
        ← {backLabel}
      </Link>
      <div className="grid gap-6 rounded-lg bg-white p-6 shadow-sm md:grid-cols-2">
        <div className="overflow-hidden rounded-md bg-gray-100">
          {imageSrc ? (
            // eslint-disable-next-line @next/next/no-img-element -- public Supabase storage URL
            <img src={imageSrc} alt={title} className="max-h-96 w-full object-contain" />
          ) : (
            <div className="flex aspect-[4/3] items-center justify-center text-sm text-gray-400">ไม่มีรูป</div>
          )}
        </div>
        <div>
          <h1 className="text-2xl font-bold text-cdti-700">{title}</h1>
          <dl className="mt-4 grid grid-cols-[7rem_1fr] gap-x-4 gap-y-2 text-sm">
            {rows.map((r) => (
              <div key={r.label} className="contents">
                <dt className="text-gray-500">{r.label}</dt>
                <dd>{r.value || "-"}</dd>
              </div>
            ))}
          </dl>
          {description && <p className="mt-4 whitespace-pre-wrap break-words text-sm text-gray-700">{description}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

