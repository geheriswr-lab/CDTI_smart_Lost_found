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

// ---------------------------------------------------------------------------
// Phase 3 — reporting
// ---------------------------------------------------------------------------

export type LostItemStatus = "reported" | "matched" | "claim_pending" | "returned" | "closed" | "cancelled";

export type FoundItemStatus =
  | "reported"
  | "in_custody"
  | "matched"
  | "claim_pending"
  | "verified"
  | "returned"
  | "closed";

export type CustodyStatus = "with_finder" | "transferred_to_staff" | "in_storage" | "released_to_owner";

export type Category = {
  id: string;
  name_th: string;
  name_en: string | null;
  is_active: boolean;
  is_high_value: boolean;
  claim_form: "general" | "wallet" | "key" | "electronics";
  created_at: string;
};

export type Location = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
};

export type HandoverLocation = {
  id: string;
  name: string;
  address: string | null;
  is_active: boolean;
  created_at: string;
};

/**
 * Image columns hold storage OBJECT PATHS (not URLs) since Phase 3:
 *   public_image_url  -> bucket "item-images-public"
 *   private_image_url -> bucket "verification-private"
 * See supabase/migrations/0018_phase3_reporting.sql.
 */
export type LostItem = {
  id: string;
  reporter_id: string;
  category_id: string | null;
  item_name: string;
  brand: string | null;
  color: string | null;
  lost_date: string | null;
  location_id: string | null;
  description: string | null;
  public_image_url: string | null;
  private_ownership_details: string | null;
  private_image_url: string | null;
  status: LostItemStatus;
  created_at: string;
  updated_at: string;
};

export type FoundItem = {
  id: string;
  finder_id: string;
  category_id: string | null;
  general_name: string;
  color: string | null;
  found_date: string | null;
  location_id: string | null;
  description: string | null;
  public_image_url: string | null;
  private_image_url: string | null;
  exact_location: string | null;
  exact_time: string | null;
  serial_number: string | null;
  secret_details: string | null;
  custody_status: CustodyStatus;
  status: FoundItemStatus;
  created_at: string;
  updated_at: string;
};

// Public views (0015_public_views.sql) — the ONLY source for guest listings.
export type PublicLostItem = {
  id: string;
  category_id: string | null;
  category_name_th: string | null;
  category_name_en: string | null;
  item_name: string;
  color: string | null;
  lost_date: string | null;
  location_id: string | null;
  location_name: string | null;
  description: string | null;
  public_image_url: string | null;
  status: LostItemStatus;
  created_at: string;
};

export type PublicFoundItem = {
  id: string;
  category_id: string | null;
  category_name_th: string | null;
  category_name_en: string | null;
  general_name: string;
  color: string | null;
  found_date: string | null;
  location_id: string | null;
  location_name: string | null;
  description: string | null;
  public_image_url: string | null;
  status: FoundItemStatus;
  created_at: string;
};

// Phase 6 — claims
export type ClaimStatus =
  | "pending"
  | "insufficient"
  | "needs_review"
  | "likely_owner"
  | "verified"
  | "approved"
  | "rejected"
  | "disputed"
  | "cancelled";
export type VerificationLevel = "standard" | "enhanced";

export type Claim = {
  id: string;
  claimant_id: string;
  found_item_id: string;
  match_id: string | null;
  status: ClaimStatus;
  verification_level: VerificationLevel;
  answers: Record<string, unknown>;
  claim_attempt_count: number;
  last_attempt_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ClaimEvidence = {
  id: string;
  claim_id: string;
  evidence_url: string;
  description: string | null;
  created_at: string;
};

export type ClaimReview = {
  id: string;
  claim_id: string;
  reviewer_id: string;
  from_status: ClaimStatus;
  outcome: ClaimStatus;
  checklist: Record<string, unknown>;
  note: string | null;
  created_at: string;
};

// Phase 7 — risk / dispute
export type RiskLevel = "low" | "medium" | "high";
export type RiskEventType =
  | "frequent_claims"
  | "repeated_rejections"
  | "duplicate_claim_target"
  | "answer_changed"
  | "new_account_high_value";
export type RiskResolution = "needs_review" | "suspicious_activity" | "cleared" | "account_restricted";

export type RiskEvent = {
  id: string;
  event_type: RiskEventType;
  risk_level: RiskLevel;
  related_user_id: string | null;
  related_item_id: string | null;
  related_claim_id: string | null;
  resolution: RiskResolution | null;
  resolution_note: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  details: Record<string, unknown>;
  created_at: string;
};

// Phase 8 — custody / handover
export type IdDocumentType = "student_card" | "staff_card" | "national_id" | "passport" | "driver_license" | "other";

export type Handover = {
  id: string;
  claim_id: string;
  found_item_id: string;
  handed_over_by: string;
  received_by: string;
  location_id: string;
  id_checked: boolean;
  id_document_type: IdDocumentType | null;
  note: string | null;
  created_at: string;
};

export type CustodyHistory = {
  id: string;
  found_item_id: string;
  from_status: CustodyStatus | null;
  to_status: CustodyStatus;
  handled_by: string | null;
  location_id: string | null;
  notes: string | null;
  created_at: string;
};

export type HandoverResult = "completed" | "invalid_code" | "expired" | "locked" | "no_code";

// Phase 10 — admin
export type InternalNote = {
  id: string;
  entity_type: "claim" | "found_item" | "lost_item" | "risk_event" | "user" | "escalation";
  entity_id: string;
  author_id: string;
  note: string;
  created_at: string;
};

export type CaseEscalation = {
  id: string;
  entity_type: "claim" | "risk_event" | "found_item";
  entity_id: string;
  reason: string;
  escalated_by: string;
  status: "open" | "resolved";
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
};

export type AdminStats = {
  lost_reports: number;
  found_reports: number;
  matches: number;
  claims: number;
  claims_approved: number;
  claims_rejected: number;
  returns: number;
  avg_return_hours: number | null;
  found_in_range: number;
  found_returned: number;
  return_success_rate: number | null;
  monthly: { month: string; lost: number; found: number; returned: number }[];
};

export type CustodyAnomalyKind =
  | "with_finder_too_long"
  | "unconfirmed_transfer"
  | "approved_not_collected"
  | "handover_code_failures"
  | "state_mismatch";

// Phase 5 — matching / notifications
export type Match = {
  id: string;
  lost_item_id: string;
  found_item_id: string;
  score: number;
  score_breakdown: Record<string, number>;
  created_at: string;
};

export type Notification = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  message: string;
  payload: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
};

export type AuditLog = {
  id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Phase 13 — Social Enterprise (0028)
// ---------------------------------------------------------------------------
import type { FundingKind, PlatformSettings, RewardStatus, FinderChoice } from "@/lib/se/labels";

export type Reward = {
  id: string;
  owner_id: string;
  lost_item_id: string | null;
  claim_id: string | null;
  finder_id: string | null;
  amount: number;
  fee_percent: number | null;
  fee_amount: number | null;
  finder_amount: number | null;
  status: RewardStatus;
  finder_choice: FinderChoice | null;
  payment_ref: string | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
  payable_at: string | null;
  paid_at: string | null;
  settled_at: string | null;
};

export type MyReward = {
  id: string;
  my_role: "owner" | "finder";
  item_name: string | null;
  claim_id: string | null;
  lost_item_id: string | null;
  amount: number;
  fee_amount: number | null;
  finder_amount: number | null;
  status: RewardStatus;
  finder_choice: FinderChoice | null;
  payment_ref: string | null;
  created_at: string;
  payable_at: string | null;
};

export type Partner = {
  id: string;
  name: string;
  description: string | null;
  website: string | null;
  internal_note: string | null;
  is_active: boolean;
  created_at: string;
};

export type PartnerPerk = {
  id: string;
  partner_id: string;
  name: string;
  description: string | null;
  quota: number | null;
  issued_count: number;
  valid_days: number;
  is_active: boolean;
  created_at: string;
};

export type PerkVoucher = {
  id: string;
  perk_id: string;
  finder_id: string;
  claim_id: string;
  code: string;
  status: "issued" | "redeemed" | "revoked";
  issued_at: string;
  expires_at: string;
  redeemed_at: string | null;
  redeemed_by: string | null;
};

export type FundingRecord = {
  id: string;
  kind: FundingKind;
  source_name: string;
  partner_id: string | null;
  amount: number;
  period_start: string | null;
  period_end: string | null;
  received_on: string;
  note: string | null;
  is_void: boolean;
  void_reason: string | null;
  created_by: string | null;
  created_at: string;
};

export type PublicPartner = { id: string; name: string; description: string | null; website: string | null; perks: string[] };

export type PublicImpact = {
  items_returned: number;
  items_returned_30d: number;
  thank_yous: number;
  thank_you_to_finders: number;
  donated_by_finders: number;
  perks_given: number;
  active_partners: number;
  reward_fee_percent: number;
};

type Table<Row, Insert> = {
  Row: Row;
  Insert: Insert;
  Update: Partial<Row>;
  Relationships: [];
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
      categories: Table<Category, Partial<Category> & { name_th: string }>;
      locations: Table<Location, Partial<Location> & { name: string }>;
      handover_locations: Table<HandoverLocation, Partial<HandoverLocation> & { name: string }>;
      lost_items: Table<
        LostItem,
        Partial<Omit<LostItem, "id" | "created_at" | "updated_at">> & { reporter_id: string; item_name: string }
      >;
      found_items: Table<
        FoundItem,
        Partial<Omit<FoundItem, "id" | "created_at" | "updated_at">> & { finder_id: string; general_name: string }
      >;
      matches: Table<Match, Omit<Match, "id" | "created_at"> & { id?: string }>;
      notifications: Table<
        Notification,
        Pick<Notification, "user_id" | "type" | "title" | "message"> & Partial<Pick<Notification, "payload" | "is_read">>
      >;
      claims: Table<Claim, never>;
      claim_evidence: Table<ClaimEvidence, Pick<ClaimEvidence, "claim_id" | "evidence_url"> & { description?: string | null }>;
      claim_reviews: Table<ClaimReview, never>;
      risk_events: Table<RiskEvent, never>;
      handovers: Table<Handover, never>;
      internal_notes: Table<InternalNote, Pick<InternalNote, "entity_type" | "entity_id" | "author_id" | "note">>;
      case_escalations: Table<CaseEscalation, never>;
      custody_history: Table<CustodyHistory, never>;
      platform_settings: Table<PlatformSettings, never>;
      rewards: Table<Reward, never>;
      partners: Table<Partner, Pick<Partner, "name"> & Partial<Omit<Partner, "id" | "created_at">>>;
      partner_perks: Table<PartnerPerk, Pick<PartnerPerk, "partner_id" | "name"> & Partial<Omit<PartnerPerk, "id" | "created_at" | "issued_count">>>;
      perk_vouchers: Table<PerkVoucher, never>;
      funding_records: Table<FundingRecord, never>;
      audit_logs: Table<AuditLog, Pick<AuditLog, "action" | "entity_type"> & Partial<Omit<AuditLog, "id" | "created_at">>>;
    };
    Views: {
      public_partners: { Row: PublicPartner; Relationships: [] };
      public_impact: { Row: PublicImpact; Relationships: [] };
      public_lost_items: {
        Row: PublicLostItem;
        Relationships: [];
      };
      public_found_items: {
        Row: PublicFoundItem;
        Relationships: [];
      };
    };
    Functions: {
      submit_claim: {
        Args: { p_found_item_id: string; p_answers: Record<string, unknown>; p_match_id?: string | null };
        Returns: string;
      };
      cancel_claim: {
        Args: { p_claim_id: string };
        Returns: undefined;
      };
      record_custody_transfer: {
        Args: { p_found_item_id: string; p_to_status: CustodyStatus; p_location_id: string; p_note?: string | null };
        Returns: undefined;
      };
      my_handover_info: {
        Args: { p_claim_id: string };
        Returns: {
          ready: boolean;
          completed: boolean;
          location_name: string | null;
          location_address: string | null;
          code_active: boolean;
          code_expires_at: string | null;
          codes_left: number;
        }[];
      };
      issue_handover_code: {
        Args: { p_claim_id: string };
        Returns: string;
      };
      complete_handover: {
        Args: {
          p_claim_id: string;
          p_code: string;
          p_location_id: string;
          p_id_checked?: boolean;
          p_id_document_type?: IdDocumentType | null;
          p_note?: string | null;
        };
        Returns: HandoverResult;
      };
      admin_stats: {
        Args: { p_from: string; p_to: string };
        Returns: AdminStats;
      };
      admin_custody_anomalies: {
        Args: Record<string, never>;
        Returns: { kind: CustodyAnomalyKind; found_item_id: string; claim_id: string | null; since: string; detail: string }[];
      };
      escalate_case: {
        Args: { p_entity_type: CaseEscalation["entity_type"]; p_entity_id: string; p_reason: string };
        Returns: string;
      };
      resolve_escalation: {
        Args: { p_id: string; p_note?: string | null };
        Returns: undefined;
      };
      resolve_risk_event: {
        Args: { p_event_id: string; p_resolution: "needs_review" | "suspicious_activity" | "cleared"; p_note?: string | null };
        Returns: undefined;
      };
      pledge_reward: { Args: { p_lost_item_id: string; p_amount: number }; Returns: string };
      cancel_reward_pledge: { Args: { p_reward_id: string }; Returns: undefined };
      offer_reward_after_return: { Args: { p_claim_id: string; p_amount: number }; Returns: string };
      pay_reward_demo: { Args: { p_reward_id: string }; Returns: string };
      set_reward_choice: { Args: { p_reward_id: string; p_choice: FinderChoice }; Returns: undefined };
      settle_reward: { Args: { p_reward_id: string }; Returns: string };
      cancel_reward_admin: { Args: { p_reward_id: string; p_reason: string }; Returns: undefined };
      my_rewards: { Args: Record<string, never>; Returns: MyReward[] };
      redeem_perk_voucher: { Args: { p_code: string }; Returns: string };
      revoke_perk_voucher: { Args: { p_voucher_id: string; p_reason: string }; Returns: undefined };
      my_vouchers: {
        Args: Record<string, never>;
        Returns: {
          id: string; perk_name: string; perk_description: string | null; partner_name: string;
          code: string; status: "issued" | "redeemed" | "revoked" | "expired"; issued_at: string; expires_at: string;
        }[];
      };
      record_funding: {
        Args: {
          p_kind: FundingKind; p_source_name: string; p_amount: number; p_received_on: string;
          p_period_start?: string | null; p_period_end?: string | null; p_partner_id?: string | null; p_note?: string | null;
        };
        Returns: string;
      };
      void_funding: { Args: { p_id: string; p_reason: string }; Returns: undefined };
      update_platform_settings: {
        Args: {
          p_fee_percent: number; p_fee_min: number; p_reward_min: number; p_reward_max: number;
          p_offer_days: number; p_vouchers_per_finder: number;
        };
        Returns: undefined;
      };
      se_summary: { Args: { p_from: string; p_to: string }; Returns: Record<string, unknown> };
      reward_fee: { Args: { p_amount: number }; Returns: number };
      set_user_role: {
        Args: { p_user_id: string; p_role: SystemRole; p_reason: string };
        Returns: undefined;
      };
      set_account_restriction: {
        Args: { p_user_id: string; p_restricted: boolean; p_reason?: string | null };
        Returns: undefined;
      };
      review_claim: {
        Args: { p_claim_id: string; p_outcome: ClaimStatus; p_checklist?: Record<string, unknown>; p_note?: string | null };
        Returns: undefined;
      };
    };
    Enums: {
      user_type_enum: UserType;
      system_role_enum: SystemRole;
      lost_item_status_enum: LostItemStatus;
      found_item_status_enum: FoundItemStatus;
      custody_status_enum: CustodyStatus;
      claim_status_enum: ClaimStatus;
      verification_level_enum: VerificationLevel;
      risk_level_enum: RiskLevel;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
