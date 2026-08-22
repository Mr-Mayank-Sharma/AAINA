-- 008: Dev seed staff user (admin@pilot.test / password: mirra-dev-2026)
-- bcrypt hash of 'mirra-dev-2026'
INSERT INTO staff_users (tenant_id, email, password_hash, role)
SELECT t.id, 'admin@pilot.test',
       '$2a$10$CCFYFfiIQHlrp34qwz96veiNNdPLr.i5yDA3udkbJpKrw8WTvQFCm',
       'admin'
FROM tenants t
WHERE NOT EXISTS (SELECT 1 FROM staff_users WHERE email = 'admin@pilot.test');
