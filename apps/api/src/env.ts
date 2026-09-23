// Load apps/api/.env if present. Imported first so every other module sees the values.
try {
  process.loadEnvFile(new URL("../.env", import.meta.url));
} catch {
  // No .env file: rely on the real environment.
}
