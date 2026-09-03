// See app/lost/page.tsx — same rationale, backed by `public_found_items`.
export default function PublicFoundItemsPage() {
  return (
    <div className="rounded-lg bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold text-cdti-700">ประกาศพบของ</h1>
      <p className="mt-2 text-gray-500">
        หน้าค้นหา/รายการพบของ (Public) — จะพัฒนาต่อใน Phase 4
      </p>
    </div>
  );
}
