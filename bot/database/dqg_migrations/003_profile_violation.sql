-- Deliberate data-quality violation for the KPI 3/4 POC test:
--   - 3 rows with a NULL admin_ip_address (a CRITICAL field per the
--     broadcast_logs.yaml contract, block=true on null-rate regression)
--   - 2 rows with a junk admin_username ("test", "n/a") matching the
--     contract's junk_patterns
-- Expected: the data-quality-gate CI check should FAIL, with a
-- null_rate finding (severity block) on admin_ip_address and a
-- junk_value_rate finding on admin_username.

INSERT INTO broadcast_logs (admin_username, admin_ip_address, message_content, filters, total_recipients)
VALUES
    ('admin_sarah',  NULL, 'Emergency notice — IP not logged (bug)', '{}', 45),
    ('admin_hassan', NULL, 'Another notice with missing IP', '{}', 60),
    ('admin_fatima', NULL, 'Third notice with missing IP', '{}', 30),
    ('test',         '203.0.113.20', 'Test broadcast, should not exist in prod', '{}', 1),
    ('n/a',          '203.0.113.21', 'Placeholder admin username', '{}', 1);
