# CDTI Smart Lost & Found — ER Diagram (Phase 1)

```mermaid
erDiagram
    PROFILES ||--o{ LOST_ITEMS : reports
    PROFILES ||--o{ FOUND_ITEMS : finds
    PROFILES ||--o{ CLAIMS : claims
    PROFILES ||--o{ NOTIFICATIONS : receives
    PROFILES ||--o{ INTERNAL_NOTES : writes
    PROFILES ||--o{ AUDIT_LOGS : acts

    CATEGORIES ||--o{ LOST_ITEMS : classifies
    CATEGORIES ||--o{ FOUND_ITEMS : classifies
    LOCATIONS ||--o{ LOST_ITEMS : "lost at"
    LOCATIONS ||--o{ FOUND_ITEMS : "found near"
    HANDOVER_LOCATIONS ||--o{ CUSTODY_HISTORY : "handover point"

    LOST_ITEMS ||--o{ MATCHES : "matched to"
    FOUND_ITEMS ||--o{ MATCHES : "matched to"
    FOUND_ITEMS ||--o{ CLAIMS : "claimed via"
    MATCHES ||--o{ CLAIMS : "originates"

    CLAIMS ||--o{ CLAIM_EVIDENCE : supports
    CLAIMS ||--o| HANDOVER_CODES : "generates"
    FOUND_ITEMS ||--o{ CUSTODY_HISTORY : "custody trail"

    LOST_ITEMS ||--o{ RISK_EVENTS : "may flag"
    FOUND_ITEMS ||--o{ RISK_EVENTS : "may flag"
    CLAIMS ||--o{ RISK_EVENTS : "may flag"

    PROFILES {
        uuid id PK
        text email
        text full_name
        user_type_enum user_type
        system_role_enum role
        boolean must_change_password
        boolean is_restricted
    }
    CATEGORIES {
        uuid id PK
        text name_th
        text name_en
    }
    LOCATIONS {
        uuid id PK
        text name
    }
    HANDOVER_LOCATIONS {
        uuid id PK
        text name
        text address
    }
    LOST_ITEMS {
        uuid id PK
        uuid reporter_id FK
        uuid category_id FK
        text item_name
        text private_ownership_details "private"
        lost_item_status_enum status
    }
    FOUND_ITEMS {
        uuid id PK
        uuid finder_id FK
        uuid category_id FK
        text general_name
        text secret_details "private"
        text serial_number "private"
        custody_status_enum custody_status
        found_item_status_enum status
    }
    MATCHES {
        uuid id PK
        uuid lost_item_id FK
        uuid found_item_id FK
        numeric score
    }
    CLAIMS {
        uuid id PK
        uuid claimant_id FK
        uuid found_item_id FK
        uuid match_id FK
        jsonb answers "private"
        claim_status_enum status
        verification_level_enum verification_level
    }
    CLAIM_EVIDENCE {
        uuid id PK
        uuid claim_id FK
        text evidence_url "private bucket"
    }
    NOTIFICATIONS {
        uuid id PK
        uuid user_id FK
        text type
        jsonb payload
    }
    RISK_EVENTS {
        uuid id PK
        text event_type
        risk_level_enum risk_level
        uuid related_claim_id FK
    }
    AUDIT_LOGS {
        uuid id PK
        uuid actor_id FK
        text action
        text entity_type
        uuid entity_id
    }
    CUSTODY_HISTORY {
        uuid id PK
        uuid found_item_id FK
        custody_status_enum from_status
        custody_status_enum to_status
        uuid handled_by FK
        uuid location_id FK
    }
    INTERNAL_NOTES {
        uuid id PK
        text entity_type
        uuid entity_id
        uuid author_id FK
    }
    HANDOVER_CODES {
        uuid id PK
        uuid claim_id FK
        text code_hash
        timestamptz expires_at
        timestamptz used_at
    }
```

## Information-asymmetry notes

- `found_items.secret_details` / `serial_number` / `exact_location` / `exact_time` never
  appear in `public_found_items`, in any `notifications.payload`, or in any response
  visible to a claimant. They exist only for the server-side verification checklist
  logic and staff/admin review.
- `claims` is deliberately **not** readable by the finder (`found_items.finder_id`) —
  only the claimant and staff/admin. This prevents a finder from coaching a claimant
  or vice versa.
- `public_lost_items` / `public_found_items` are Postgres views with
  `security_invoker = false`, so they expose only the whitelisted columns
  regardless of the querying role's RLS visibility on the base tables — the
  base tables themselves have **no** public/anon SELECT policy at all.
