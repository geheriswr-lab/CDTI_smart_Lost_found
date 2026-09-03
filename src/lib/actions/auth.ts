"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UserType } from "@/types/database.types";

export type ActionState = { error: string | null };

const USER_TYPES: UserType[] = [
  "vocational_student",
  "university_student",
  "teacher_staff",
  "royal_household_staff",
  "external_visitor",
];

export async function signUpAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("full_name") ?? "").trim();
  const userType = String(formData.get("user_type") ?? "") as UserType;

  if (!email || !password || !fullName) {
    return { error: "กรุณากรอกข้อมูลให้ครบถ้วน" };
  }
  if (password.length < 8) {
    return { error: "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร" };
  }
  if (!USER_TYPES.includes(userType)) {
    return { error: "กรุณาเลือกประเภทผู้ใช้งาน" };
  }

  const supabase = await createClient();

  // profiles.role is intentionally NOT settable here — handle_new_user()
  // (0002_profiles.sql) always inserts role='user' server-side, regardless
  // of anything passed in raw_user_meta_data. Privilege can only ever be
  // granted later by an admin via profiles_update_admin.
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
        user_type: userType,
      },
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/auth/callback`,
    },
  });

  if (error) {
    return { error: error.message };
  }

  redirect("/login?registered=1");
}

export async function signInAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/dashboard");

  if (!email || !password) {
    return { error: "กรุณากรอกอีเมลและรหัสผ่าน" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Deliberately generic — don't reveal whether the email exists.
    return { error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" };
  }

  // middleware.ts will bounce to /change-password on the next request if
  // must_change_password is set, so redirecting to `next` here is safe.
  redirect(next.startsWith("/") ? next : "/dashboard");
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function changePasswordAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const newPassword = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirm_password") ?? "");

  if (newPassword.length < 8) {
    return { error: "รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร" };
  }
  if (newPassword !== confirmPassword) {
    return { error: "รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { error: updateAuthError } = await supabase.auth.updateUser({
    password: newPassword,
  });
  if (updateAuthError) {
    return { error: updateAuthError.message };
  }

  // Allowed by trg_profiles_protect_sensitive_fields (0017): the owning
  // user may flip must_change_password true -> false, and only that
  // direction, only on their own row.
  const { error: updateProfileError } = await supabase
    .from("profiles")
    .update({ must_change_password: false })
    .eq("id", user.id);

  if (updateProfileError) {
    return { error: updateProfileError.message };
  }

  redirect("/dashboard");
}
