"""Parameterized query and transaction example for the PocketDB PostgreSQL bridge."""

import json
import os
import uuid

import psycopg


port = int(os.environ.get("POCKETDB_LOCAL_PORT", "5432"))
table = f"task_049_python_{uuid.uuid4().hex[:12]}"

with psycopg.connect(
    host="127.0.0.1",
    port=port,
    user="pocketdb",
    dbname="demo",
    autocommit=True,
) as connection:
    connection.execute(f'CREATE TABLE "{table}" (key text PRIMARY KEY, value text)')
    with connection.transaction():
        connection.execute(
            f'INSERT INTO "{table}" (key, value) VALUES (%s, %s)',
            ("greeting", "hello from psycopg"),
        )
    row = connection.execute(
        f'SELECT value FROM "{table}" WHERE key = %s', ("greeting",)
    ).fetchone()
    assert row == ("hello from psycopg",), row
    connection.execute(f'DROP TABLE "{table}"')

print(
    json.dumps(
        {
            "driver": "psycopg",
            "version": psycopg.__version__,
            "parameterizedQuery": True,
            "transaction": "committed",
            "connectionClosed": True,
        }
    )
)
