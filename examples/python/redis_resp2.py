"""Binary-safe redis-py example for the PocketDB RESP2 bridge."""

import json
import os
import uuid

import redis


port = int(os.environ.get("POCKETDB_LOCAL_PORT", "6379"))
key = f"task_049_python:{uuid.uuid4().hex}".encode()
value = b"PocketDB\x00\xff\r\n"
client = redis.Redis(
    host="127.0.0.1",
    port=port,
    protocol=2,
    decode_responses=False,
    socket_connect_timeout=5,
    socket_timeout=10,
)

try:
    assert client.ping() is True
    assert client.set(key, value) is True
    assert client.get(key) == value
    try:
        client.incr(key)
    except redis.exceptions.ResponseError as error:
        unsupported = str(error)
        assert "unsupported command" in unsupported
    else:
        raise AssertionError("INCR should be rejected by the documented subset")
    assert client.delete(key) == 1
finally:
    client.close()

print(
    json.dumps(
        {
            "client": "redis-py",
            "version": redis.__version__,
            "protocol": 2,
            "binaryRoundTrip": True,
            "unsupportedCommand": "INCR rejected",
            "connectionClosed": True,
        }
    )
)
