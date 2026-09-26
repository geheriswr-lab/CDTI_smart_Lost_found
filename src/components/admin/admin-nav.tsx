import Link from "next/link";

const LINKS: { href: string; label: string; adminOnly?: boolean }[] = [
  { href: "/admin", label: "ภาพรวม" },
  { href: "/admin/claims", label: "คำขอรับของ" },
  { href: "/admin/risk", label: "สัญญาณ" },
  { href: "/admin/escalations", label: "เรื่องส่งต่อ" },
  { href: "/admin/custody", label: "การครอบครอง" },
  { href: "/admin/handovers", label: "ส่งมอบ" },
  { href: "/admin/stats", label: "สถิติ" },
  { href: "/admin/se", label: "SE / รายได้" },
  { href: "/admin/partners", label: "ผู้สนับสนุน" },
  { href: "/admin/audit", label: "Audit log" },
  { href: "/admin/categories", label: "ประเภท" },
  { href: "/admin/locations", label: "สถานที่" },
  { href: "/admin/handover-locations", label: "จุดส่งมอบ" },
  { href: "/admin/users", label: "ผู้ใช้ / สิทธิ์", adminOnly: true },
];

export function AdminNav({ role }: { role: string }) {
  return (
    <nav aria-label="เมนู admin" className="mb-6 flex flex-wrap gap-1.5 rounded-lg bg-white p-2 text-sm shadow-sm">
      <span className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-gray-400">{role}</span>
      {LINKS.filter((l) => !l.adminOnly || role === "admin").map((l) => (
        <Link key={l.href} href={l.href} className="rounded-md px-2.5 py-1 text-gray-700 hover:bg-cdti-50 hover:text-cdti-700">
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
