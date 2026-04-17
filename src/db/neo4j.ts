import neo4j, { Driver } from "neo4j-driver";

let driver: Driver | null = null;

export function getNeo4jDriver(): Driver {
  if (!driver) {
    const uri = process.env.NEO4J_URI;
    const user = process.env.NEO4J_USER;
    const password = process.env.NEO4J_PASSWORD;

    if (!uri || !user || !password) {
      throw new Error("NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD are required");
    }

    driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  }
  return driver;
}

export async function closeNeo4j(): Promise<void> {
  if (driver) {
    await driver.close();
    driver = null;
  }
}
