"use client";

import { useFormState, useFormStatus } from "react-dom";
import { changePasswordAction, type ActionState } from "@/lib/actions/auth";

const initialState: ActionState = { error: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-cdti-600 px-4 py-2 text-white hover:bg-cdti-700 disabled:opacity-60"
    >
      {pending ? "กำลังบันทึก..." : "เปลี่ยนรหัสผ่าน"}
    </button>
  );
}

export function ChangePasswordForm() {
  const [state, formAction] = useFormState(changePasswordAction, initialState);

  return (
    <form action={formAction} className="mt-4 space-y-3">
      <div>
        <label className="block text-sm text-gray-700" htmlFor="password">
          รหัสผ่านใหม่
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
      </div>

      <div>
        <label className="block text-sm text-gray-700" htmlFor="confirm_password">
          ยืนยันรหัสผ่านใหม่
        </label>
        <input
          id="confirm_password"
          name="confirm_password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-cdti-500 focus:outline-none"
        />
      </div>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}

      <SubmitButton />
    </form>
  );
}
