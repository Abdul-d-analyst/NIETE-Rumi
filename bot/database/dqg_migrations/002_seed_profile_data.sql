-- Seed data for the data-profile gate POC — real rows so KPI 3
-- (critical-field rules) and KPI 4 (junk-value/anomaly detection) have
-- actual data to compute against, not just an empty table.

INSERT INTO broadcast_logs (admin_username, admin_ip_address, message_content, filters, total_recipients)
VALUES
    ('admin_sarah',  '203.0.113.5',  'Weekly update for Grade 5 teachers', '{}', 120),
    ('admin_hassan', '203.0.113.9',  'Reminder: submit attendance by Friday', '{}', 340),
    ('admin_fatima', '198.51.100.2', 'New lesson plans available', '{}', 88),
    ('admin_sarah',  '203.0.113.5',  'Holiday schedule announcement', '{}', 500),
    ('admin_hassan', '198.51.100.7', 'System maintenance notice', '{}', 12);
