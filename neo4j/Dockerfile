FROM neo4j:5-community

# Environment defaults (override via Coolify UI)
ENV NEO4J_AUTH=neo4j/changeme123
ENV NEO4J_PLUGINS=["apoc"]
ENV NEO4J_server_memory_heap_initial__size=256m
ENV NEO4J_server_memory_heap_max__size=512m
ENV NEO4J_server_memory_pagecache_size=256m
ENV NEO4J_dbms_security_procedures_unrestricted=apoc.*

# Expose ports
# 7474 = HTTP (Neo4j Browser)
# 7687 = Bolt (driver connection)
EXPOSE 7474 7687

# Data directories — mount volumes to these paths for persistence
VOLUME ["/data", "/logs"]
