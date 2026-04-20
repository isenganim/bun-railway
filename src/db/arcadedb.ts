const ARCADEDB_URL = process.env.ARCADEDB_URL || "http://localhost:2480";
const ARCADEDB_DATABASE = process.env.ARCADEDB_DATABASE || "bun_railway";
const ARCADEDB_USER = process.env.ARCADEDB_USER || "root";
const ARCADEDB_PASSWORD = process.env.ARCADEDB_PASSWORD || "playwithdata";

const auth = "Basic " + btoa(`${ARCADEDB_USER}:${ARCADEDB_PASSWORD}`);

export async function arcadeQuery(language: string, command: string, params?: Record<string, unknown>) {
  const res = await fetch(`${ARCADEDB_URL}/api/v1/query/${ARCADEDB_DATABASE}`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({ language, command, params }),
  });
  if (!res.ok) throw new Error(`ArcadeDB query error: ${res.status} ${await res.text()}`);
  return res.json() as Promise<{ result: Record<string, unknown>[] }>;
}

export async function arcadeCommand(language: string, command: string, params?: Record<string, unknown>) {
  const res = await fetch(`${ARCADEDB_URL}/api/v1/command/${ARCADEDB_DATABASE}`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({ language, command, params }),
  });
  if (!res.ok) throw new Error(`ArcadeDB command error: ${res.status} ${await res.text()}`);
  return res.json() as Promise<{ result: Record<string, unknown>[] }>;
}

export async function arcadeReady(): Promise<boolean> {
  try {
    const res = await fetch(`${ARCADEDB_URL}/api/v1/ready`);
    return res.status === 204;
  } catch {
    return false;
  }
}
