"use client";

import { useFormState, useFormStatus } from "react-dom";
import { signUpAction, type ActionState } from "@/lib/actions/auth";

const initialState: ActionState = { error: null };

// Must exactly match public.user_type_enum in setup_all.sql.
const USER_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "vocational_student", label: "นักเรียนอาชีวศึกษา" },
  { value: "university_student", label: "นักศึกษาระดับอุดมศึกษา" },
  { value: "teacher_staff", label: "ครู/บุคลากร" },
  { value: "royal_household_staff", label: "บุคลากรสำนักพระราชวัง" },
  { value: "external_visitor", label: "บุคคลภายนอก" },
];

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-cdti-600 px-4 py-2 text-white hover:bg-cdti-700 disabled:opacity-60"
    >
      {pending ? "กำลังสมัครสมาชิก..." : "สมัครสมาชิก"}
    </button>
  );
}

export function SignupForm() {
  const [state, formAction] = useFormState(signUpAction, initialState);

  return (
    <form action={formAction} className="mt-4 space-y-3">
      <div>
        <label className="block text-sm text-gray-700" htmlFor="full_name">
          ชื่อ-นามสกุล
        </label>
        <input
          id="full_name"
          name="full_name"
          type="text"
          required
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-cdti-500 focus:outline-none"
        />
      </div>

      <div>
        <label className="block text-sm text-gray-700" htmlFor="email">
          อีเมล
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-cdti-500 focus:outline-none"
        />
      </div>

      <div>
        <label className="block text-sm text-gray-700" htmlFor="user_type">
          ประเภทผู้ใช้งาน
        </label>
        <select
          id="user_type"
          name="user_type"
          required
          defaultValue=""
          className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-cdti-500 focus:outline-none"
        >
          <option value="" disabled>
            เลือกประเภทผู้ใช้งาน
          </option>
          {USER_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm text-gray-700" htmlFor="password">
          รหัสผ่าน
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-cdti-500 focus:outline-none"
        />
        <p className="mt-1 text-xs text-gray-400">อย่างน้อย 8 ตัวอักษร</p>
      </div>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}

      <SubmitButton />
    </form>
  );
}
