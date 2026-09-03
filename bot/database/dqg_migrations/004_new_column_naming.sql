-- Deliberate KPI 5 (new fields and naming) POC test:
--   - dashboard_audit_log.contact_phone_number: a new PII-shaped column
--     (matches contract_check.py's phone_number pattern) with NO
--     sensitivity classification declared in dashboard_audit_log.yaml.
--     Expected: BLOCKS (new_pii_column_unclassified).
--   - dashboard_audit_log.priority_level: a new, non-PII column not
--     listed in the contract's columns.allowed. Expected: advisory-only
--     finding (column_not_in_contract), never blocking, so this alone
--     must not fail the check.

ALTER TABLE dashboard_audit_log ADD COLUMN IF NOT EXISTS contact_phone_number TEXT;
ALTER TABLE dashboard_audit_log ADD COLUMN IF NOT EXISTS priority_level TEXT;
