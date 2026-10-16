// Environnement de test : valeurs factices, jamais de secret réel.
process.env.AUTH_SECRET = "unit-test-secret-unit-test-secret-0000";
process.env.PAD_SSO_SHARED_SECRET = "unit-test-sso-secret-unit-test-sso-0000";
process.env.CTFD_URL = "http://ctfd.test";
process.env.AUTH_AUTHENTIK_ISSUER = "https://auth.example.test/application/o/pad-frontend/";
process.env.AUTH_AUTHENTIK_SECRET = "unit-test-oidc-secret";
process.env.PAD_FLAG_RATE_LIMIT = "3";
process.env.PAD_FLAG_RATE_WINDOW_S = "60";
process.env.LOG_LEVEL = "silent";
delete process.env.PAD_MOCK;
delete process.env.VALKEY_URL;
delete process.env.METRICS_TOKEN;
