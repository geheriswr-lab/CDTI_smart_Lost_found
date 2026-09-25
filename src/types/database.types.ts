// Hand-written to match supabase/setup_all.sql (Phase 1).
// If the schema changes, regenerate with:
//   supabase gen types typescript --project-id <ref> > src/types/database.types.ts
// and re-check that the enums/columns referenced in src/lib and app/ still line up.

export type UserType =
  | "vocational_student"
  | "university_student"
  | "teacher_staff"
  | "royal_household_staff"
  | "external_visitor";

export type SystemRole = "user" | "staff" | "admin";

export type Profile = {
  id: string;
  email: string;
  full_name: string;
  user_type: UserType;
  role: SystemRole;
  must_change_password: boolean;
  phone: string | null;
  is_restricted: boolean;
  created_at: string;
  updated_at: string;
};

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "13";
  };
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Partial<Profile> & { id: string; email: string; full_name: string; user_type: UserType };
        Update: Partial<Profile>;
        Relationships: [];
      };
    };
    Views: {
      // Phase 4 will consume these; declared now so early code can reference
      // them with real types instead of `any`.
      public_lost_items: {
        Row: Record<string, unknown>;
        Relationships: [];
      };
      public_found_items: {
        Row: Record<string, unknown>;
        Relationships: [];
      };
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      user_type_enum: UserType;
      system_role_enum: SystemRole;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
