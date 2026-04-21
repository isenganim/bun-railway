# ArcadeDB Setup

ArcadeDB is a multi-model database (graph, document, key-value) that supports Cypher, SQL, Gremlin, and MongoDB protocols.

## Ports

| Port | Protocol | Purpose |
|------|----------|---------|
| 2480 | HTTP | REST API + Studio UI |
| 2481 | HTTPS | REST API (TLS) |
| 2424 | Binary | Gremlin / remote protocol |

## Local Development

```bash
cd arcadedb
cp .env.example .env
# Edit .env with your password
docker compose up -d
```

Studio UI: http://localhost:2480

## Deploy on Coolify

1. In Coolify, create a new **Dockerfile** service
2. Point it to this `arcadedb/` directory (or the repo root with `Dockerfile` path set)
3. Set these environment variables in Coolify:

```dotenv
JAVA_OPTS="-Darcadedb.server.rootPassword=<your-password> -Darcadedb.server.defaultDatabases=bun_railway[root]"
```

4. Expose port **2480** (HTTP API)
5. Add a persistent volume: `/home/arcadedb/databases`
6. Health check URL: `http://<host>:2480/api/v1/ready`

## App Environment Variables

Add to your app's `.env`:

```dotenv
ARCADEDB_URL=http://<arcadedb-host>:2480
ARCADEDB_DATABASE=bun_railway
ARCADEDB_USER=root
ARCADEDB_PASSWORD=<your-password>
```

## API Quick Test

```bash
# Health check
curl http://localhost:2480/api/v1/ready

# Create database (first time)
curl -u root:<password> -X POST http://localhost:2480/api/v1/server \
  -H "Content-Type: application/json" \
  -d '{"command":"create database bun_railway"}'

# Run an OpenCypher query
curl -u root:<password> -X POST http://localhost:2480/api/v1/query/bun_railway \
  -H "Content-Type: application/json" \
  -d '{"language":"opencypher","command":"MATCH (n) RETURN count(n)"}'
```
