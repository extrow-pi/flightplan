/** A Postgres unique-constraint violation (PGlite reports it directly, postgres-js wraps it in `cause`). */
export const isUniqueViolation = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
};
