# Offline fixtures only

All credentials, users, keys and network identities here are synthetic public test vectors.
Historical SQL is regression input, never an active migration. clean-project-binding.sql records the
separately approved local B1 experiment and must never run in CI or production. No test supplies a
real credential provider or enables the database. legacy-grant-service/test-proof exist only for
pre-M5 transaction models; production uses registered admission. See docs/s3/README.md.
