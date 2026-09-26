import Link from "next/link";
import type { ReferenceData } from "@/lib/reports/queries";
import { PAGE_SIZE, buildSearchHref, hasActiveFilters, type PublicSearch } from "@/lib/listing/search";
import { formatThaiDate } from "@/lib/reports/labels";

const inputClass =
  "mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-cdti-500 focus:outline-none";

/**
 * Plain GET form — works without JavaScript and keeps every filter in the
 * URL, so searches are shareable/bookmarkable. Only public fields are offered.
 */
export function SearchFilters({
  basePath,
  search,
  refs,
  dateLabel,
}: {
  basePath: string;
  search: PublicSearch;
  refs: Pick<ReferenceData, "categories" | "locations">;
  dateLabel: string;
}) {
  return (
    <form method="get" action={basePath} className="rounded-lg bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="flex-1">
          <span className="sr-only">ค้นหา</span>
          <input
            name="q"
            type="search"
            defaultValue={search.q ?? ""}
            maxLength={60}
            placeholder="ค้นหาชื่อสิ่งของ เช่น โทรศัพท์, กุญแจ"
            className={inputClass + " mt-0"}
          />
        </label>
        <button type="submit" className="rounded-md bg-cdti-600 px-5 py-2 text-sm text-white hover:bg-cdti-700">
          ค้นหา
        </button>
      </div>

      <details className="group mt-3" open={hasActiveFilters(search) && !search.q ? true : undefined}>
        <summary className="cursor-pointer select-none text-sm text-cdti-700">ตัวกรองเพิ่มเติม</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-sm text-gray-700">
            ประเภท
            <select name="category" defaultValue={search.category ?? ""} className={inputClass}>
              <option value="">ทั้งหมด</option>
              {refs.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name_th}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-gray-700">
            สี
            <input name="color" defaultValue={search.color ?? ""} maxLength={30} placeholder="เช่น ดำ" className={inputClass} />
          </label>
          <label className="text-sm text-gray-700">
            พื้นที่
            <select name="location" defaultValue={search.location ?? ""} className={inputClass} disabled={refs.locations.length === 0}>
              <option value="">ทั้งหมด</option>
              {refs.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-gray-700">
            {dateLabel} ตั้งแต่
            <input name="from" type="date" defaultValue={search.from ?? ""} className={inputClass} />
          </label>
          <label className="text-sm text-gray-700">
            ถึง
            <input name="to" type="date" defaultValue={search.to ?? ""} className={inputClass} />
          </label>
        </div>
        <div className="mt-3 flex gap-3 text-sm">
          <button type="submit" className="rounded-md border border-cdti-200 px-4 py-1.5 text-cdti-700 hover:bg-cdti-50">
            ใช้ตัวกรอง
          </button>
          {hasActiveFilters(search) && (
            <Link href={basePath} className="px-2 py-1.5 text-gray-500 hover:text-gray-700">
              ล้างตัวกรอง
            </Link>
          )}
        </div>
      </details>
    </form>
  );
}

export function ItemCard({
  href,
  title,
  imageSrc,
  category,
  color,
  date,
  dateLabel,
  location,
}: {
  href: string;
  title: string;
  imageSrc: string | null;
  category: string | null;
  color: string | null;
  date: string | null;
  dateLabel: string;
  location: string | null;
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex h-full flex-col overflow-hidden rounded-lg bg-white shadow-sm ring-cdti-200 transition hover:ring-1"
      >
        <div className="aspect-[4/3] w-full bg-gray-100">
          {imageSrc ? (
            // eslint-disable-next-line @next/next/no-img-element -- public Supabase storage URL
            <img src={imageSrc} alt={title} loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-gray-400">ไม่มีรูป</div>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-1 p-3 text-sm">
          <p className="line-clamp-1 font-semibold text-gray-900">{title}</p>
          {category && (
            <span className="w-fit rounded-full bg-cdti-50 px-2 py-0.5 text-xs text-cdti-700">{category}</span>
          )}
          <dl className="mt-1 space-y-0.5 text-xs text-gray-600">
            {color && (
              <div>
                <dt className="inline text-gray-400">สี: </dt>
                <dd className="inline">{color}</dd>
              </div>
            )}
            <div>
              <dt className="inline text-gray-400">{dateLabel}: </dt>
              <dd className="inline">{formatThaiDate(date)}</dd>
            </div>
            {location && (
              <div>
                <dt className="inline text-gray-400">บริเวณ: </dt>
                <dd className="inline">{location}</dd>
              </div>
            )}
          </dl>
        </div>
      </Link>
    </li>
  );
}

export function ResultSummary({ total, search }: { total: number; search: PublicSearch }) {
  return (
    <p className="text-sm text-gray-500">
      {hasActiveFilters(search) ? "ผลการค้นหา " : "ทั้งหมด "}
      <span className="font-medium text-gray-700">{total.toLocaleString("th-TH")}</span> รายการ
    </p>
  );
}

export function Pagination({ basePath, search, total }: { basePath: string; search: PublicSearch; total: number }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (pages <= 1) return null;
  const prev = search.page > 1 ? buildSearchHref(basePath, { ...search, page: search.page - 1 }) : null;
  const next = search.page < pages ? buildSearchHref(basePath, { ...search, page: search.page + 1 }) : null;
  const btn = "rounded-md border border-gray-200 bg-white px-3 py-1.5 hover:bg-gray-50";
  return (
    <nav aria-label="เปลี่ยนหน้า" className="flex items-center justify-center gap-3 text-sm">
      {prev ? <Link href={prev} className={btn}>← ก่อนหน้า</Link> : <span className={btn + " opacity-40"}>← ก่อนหน้า</span>}
      <span className="text-gray-500">
        หน้า {search.page} / {pages}
      </span>
      {next ? <Link href={next} className={btn}>ถัดไป →</Link> : <span className={btn + " opacity-40"}>ถัดไป →</span>}
    </nav>
  );
}

export function EmptyState({ filtered, basePath, children }: { filtered: boolean; basePath: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-white p-8 text-center text-sm text-gray-500 shadow-sm">
      {filtered ? (
        <>
          ไม่พบรายการที่ตรงกับเงื่อนไข{" "}
          <Link href={basePath} className="text-cdti-600 hover:underline">
            ล้างตัวกรอง
          </Link>
        </>
      ) : (
        "ยังไม่มีประกาศ"
      )}
      {children}
    </div>
  );
}
