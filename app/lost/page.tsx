// Phase 4 will replace this with the real public listing, querying the
// `public_lost_items` view (see 0015_public_views.sql) which already
// excludes reporter_id / private_ownership_details / private_image_url at
// the database level. This stub only exists to prove out Phase 2's
// guest-browsing route rule in middleware.ts.
export default function PublicLostItemsPage() {
  return (
    <div className="rounded-lg bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold text-cdti-700">ประกาศของหาย</h1>
      <p className="mt-2 text-gray-500">
        หน้าค้นหา/รายการของหาย (Public) — จะพัฒนาต่อใน Phase 4
      </p>
    </div>
  );
}
