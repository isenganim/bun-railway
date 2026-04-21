const ARCADEDB_URL = process.env.ARCADEDB_URL || "http://localhost:2480";
const ARCADEDB_DATABASE = process.env.ARCADEDB_DATABASE || "bun_railway";
const ARCADEDB_USER = process.env.ARCADEDB_USER || "root";
const ARCADEDB_PASSWORD =
  process.env.ARCADEDB_PASSWORD?.trim() ||
  (process.env.NODE_ENV === "production"
    ? (() => { throw new Error("ARCADEDB_PASSWORD is required in production"); })()
    : "playwithdata");

const ARCADEDB_TIMEOUT_MS = (() => {
  const t = Number(process.env.ARCADEDB_TIMEOUT_MS ?? 5000);
  return Number.isFinite(t) && t >= 0 ? t : 5000;
})();

const auth = "Basic " + btoa(`${ARCADEDB_USER}:${ARCADEDB_PASSWORD}`);

export async function arcadeQuery(language: string, command: string, params?: Record<string, unknown>) {
  const res = await fetch(`${ARCADEDB_URL}/api/v1/query/${ARCADEDB_DATABASE}`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({ language, command, params }),
    signal: AbortSignal.timeout(ARCADEDB_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`ArcadeDB query error: ${res.status} ${await res.text()}`);
  return res.json() as Promise<{ result: Record<string, unknown>[] }>;
}

export async function arcadeCommand(language: string, command: string, params?: Record<string, unknown>) {
  const res = await fetch(`${ARCADEDB_URL}/api/v1/command/${ARCADEDB_DATABASE}`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({ language, command, params }),
    signal: AbortSignal.timeout(ARCADEDB_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`ArcadeDB command error: ${res.status} ${await res.text()}`);
  return res.json() as Promise<{ result: Record<string, unknown>[] }>;
}

export async function arcadeReady(): Promise<boolean> {
  try {
    const res = await fetch(`${ARCADEDB_URL}/api/v1/ready`, { signal: AbortSignal.timeout(2000) });
    return res.status === 204;
  } catch {
    return false;
  }
}
