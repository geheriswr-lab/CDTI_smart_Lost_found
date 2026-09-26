"use client";

import { useFormState, useFormStatus } from "react-dom";
import { requestPasswordResetAction, type ResetRequestState } from "@/lib/actions/auth";

const initialState: ResetRequestState = { error: null, sent: false };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-cdti-600 px-4 py-2 text-white hover:bg-cdti-700 disabled:opacity-60"
    >
      {pending ? "กำลังส่ง..." : "ส่งลิงก์ตั้งรหัสผ่านใหม่"}
    </button>
  );
}

export function ForgotPasswordForm() {
  const [state, formAction] = useFormState(requestPasswordResetAction, initialState);

  if (state.sent) {
    return (
      <p className="mt-4 rounded-md bg-green-50 p-3 text-sm text-green-700">
        ถ้าอีเมลนี้มีบัญชีในระบบ คุณจะได้รับลิงก์ตั้งรหัสผ่านใหม่ภายในไม่กี่นาที (ตรวจโฟลเดอร์ Spam ด้วย)
      </p>
    );
  }

  return (
    <form action={formAction} className="mt-4 space-y-3">
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
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <SubmitButton />
    </form>
  );
}
