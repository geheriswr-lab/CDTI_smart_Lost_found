import Link from "next/link";

export default function HomePage() {
  return (
    <div className="space-y-6">
      <section className="rounded-lg bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-cdti-700">
          ระบบแจ้งของหาย / แจ้งพบของ
        </h1>
        <p className="mt-2 text-gray-600">
          สถาบันเทคโนโลยีจิตรลดา — ค้นหาประกาศได้โดยไม่ต้องเข้าสู่ระบบ
          หากต้องการแจ้งของหายหรือแจ้งพบของ กรุณาเข้าสู่ระบบก่อน
        </p>
        <div className="mt-4 flex gap-3">
          <Link
            href="/lost"
            className="rounded-md bg-cdti-600 px-4 py-2 text-white hover:bg-cdti-700"
          >
            ดูประกาศของหาย
          </Link>
          <Link
            href="/found"
            className="rounded-md border border-cdti-200 px-4 py-2 text-cdti-700 hover:bg-cdti-50"
          >
            ดูประกาศพบของ
          </Link>
        </div>
      </section>
    </div>
  );
}
