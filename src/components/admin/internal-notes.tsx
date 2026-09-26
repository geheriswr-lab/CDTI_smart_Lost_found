import { createClient } from "@/lib/supabase/server";
import { deleteNoteAction } from "@/lib/actions/admin";
import { formatThaiDateTime } from "@/lib/reports/labels";
import { NoteForm } from "./admin-forms";

/** Staff-only notes thread (RLS internal_notes_select_staff). */
export async function InternalNotes({
  entityType,
  entityId,
  meId,
  isAdmin,
  returnTo,
}: {
  entityType: "claim" | "found_item" | "lost_item" | "risk_event" | "user" | "escalation";
  entityId: string;
  meId: string;
  isAdmin: boolean;
  returnTo: string;
}) {
  const supabase = await createClient();
  const { data: notes } = await supabase
    .from("internal_notes")
    .select("id, author_id, note, created_at")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("created_at");
  const authorIds = [...new Set((notes ?? []).map((n) => n.author_id))];
  const { data: authors } = authorIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", authorIds)
    : { data: [] as { id: string; full_name: string }[] };
  const name = new Map((authors ?? []).map((a) => [a.id, a.full_name]));

  return (
    <section className="rounded-lg bg-white p-5 text-sm shadow-sm">
      <h2 className="font-semibold text-cdti-700">บันทึกภายใน</h2>
      <p className="text-xs text-gray-500">เห็นเฉพาะเจ้าหน้าที่ · ลบได้เฉพาะผู้เขียนหรือ admin · ทุกการเพิ่ม/ลบถูกบันทึกใน audit log</p>
      <ul className="mt-3 space-y-2">
        {(notes ?? []).map((n) => (
          <li key={n.id} className="rounded-md bg-gray-50 p-2">
            <p className="whitespace-pre-wrap break-words">{n.note}</p>
            <div className="mt-1 flex items-center justify-between text-xs text-gray-500">
              <span>
                {name.get(n.author_id) ?? "-"} · {formatThaiDateTime(n.created_at)}
              </span>
              {(n.author_id === meId || isAdmin) && (
                <form action={deleteNoteAction}>
                  <input type="hidden" name="note_id" value={n.id} />
                  <input type="hidden" name="return_to" value={returnTo} />
                  <button type="submit" className="text-gray-400 hover:text-red-600">
                    ลบ
                  </button>
                </form>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-3">
        <NoteForm entityType={entityType} entityId={entityId} returnTo={returnTo} />
      </div>
    </section>
  );
}
