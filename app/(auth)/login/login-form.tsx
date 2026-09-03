"use client";

import { useFormState } from "react-dom";
import { useFormStatus } from "react-dom";
import { signInAction, type ActionState } from "@/lib/actions/auth";

const initialState: ActionState = { error: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-cdti-600 px-4 py-2 text-white hover:bg-cdti-700 disabled:opacity-60"
    >
      {pending ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
    </button>
  );
}

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction] = useFormState(signInAction, initialState);

  return (
    <form action={formAction} className="mt-4 space-y-3">
      <input type="hidden" name="next" value={next ?? "/dashboard"} />

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
        <label className="block text-sm text-gray-700" htmlFor="password">
          รหัสผ่าน
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-cdti-500 focus:outline-none"
        />
      </div>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}

      <SubmitButton />
    </form>
  );
}
