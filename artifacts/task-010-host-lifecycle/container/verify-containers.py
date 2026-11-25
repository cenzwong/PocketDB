import json
import os
import subprocess
from time import monotonic, sleep

CLI = os.environ.get("POCKETDB_CONTAINER", "container")
IMAGE = os.environ.get("POCKETDB_CONTAINER_IMAGE", "pocketdb-lifecycle-local:1")
HOST = f"pocketdb-test-host-{os.getpid()}"
CLIENT = f"pocketdb-test-client-{os.getpid()}"
REQUEST = """
fetch("http://127.0.0.1:9461/", {method: "POST", body: process.argv[1]})
  .then(async response => {
    const body = await response.text();
    if (!response.ok) throw new Error(body);
    console.log(body);
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
"""

def container(*args, timeout=60):
    result = subprocess.run([CLI, *args], capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise subprocess.CalledProcessError(result.returncode, args[0], result.stdout, result.stderr)
    return result.stdout

def action(guest, name, signal=None):
    return json.loads(container("exec", guest, "node", "-e", REQUEST,
                                json.dumps({"action": name, "signal": signal}), timeout=25))

def chromium_signal(guest, name):
    script = """
const fs = require("node:fs");
const pids = fs.readdirSync("/proc").filter(name => /^\\d+$/.test(name)).filter(pid => {
  try { return fs.readFileSync(`/proc/${pid}/comm`, "utf8").trim() === "chromium"; }
  catch { return false; }
});
for (const pid of pids) {
  try { process.kill(Number(pid), process.argv[1]); }
  catch (error) { if (error.code !== "ESRCH") throw error; }
}
console.log(pids.length);
"""
    count = int(container("exec", guest, "node", "-e", script, name))
    assert count > 0
    return count

def ready(guest):
    deadline = monotonic() + 35
    while monotonic() < deadline:
        try:
            return action(guest, "info")
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
            sleep(0.4)
    raise RuntimeError(f"{guest} did not start: {container('logs', guest)[-4000:]}")

def negotiate():
    offer = action(CLIENT, "offer")
    answer = action(HOST, "answer", offer)
    assert action(CLIENT, "connect", answer) is True

created = []
try:
    for guest in (HOST, CLIENT):
        container("run", "-d", "--name", guest, "--cpus", "2", "--memory", "1g", IMAGE)
        created.append(guest)
    host = ready(HOST)
    client = ready(CLIENT)
    host["hostname"] = container("exec", HOST, "hostname").strip()
    client["hostname"] = container("exec", CLIENT, "hostname").strip()
    assert host["hostname"] != client["hostname"]
    addresses = [container("exec", guest, "hostname", "-I").strip() for guest in (HOST, CLIENT)]
    assert all(addresses) and addresses[0] != addresses[1]

    negotiate()
    seeded = action(CLIENT, "seed")
    before = action(CLIENT, "read")
    assert seeded["value"]["value"] == before["value"]["value"] == "lifecycle-marker"
    assert seeded["value"]["boot"] == before["value"]["boot"]

    suspended = monotonic()
    browser_processes = chromium_signal(HOST, "SIGSTOP")
    try:
        while_suspended = action(CLIENT, "read")
        assert while_suspended["event"] in ("timeout", "error")
    finally:
        chromium_signal(HOST, "SIGCONT")
    resumed = monotonic()
    after_resume = action(CLIENT, "read")
    assert after_resume["event"] == "reply"
    assert after_resume["value"]["boot"] == before["value"]["boot"]

    stop_started = monotonic()
    container("stop", HOST)
    stopped = monotonic()
    during = action(CLIENT, "read")
    assert during["event"] in ("timeout", "error")
    observed = monotonic()
    assert action(CLIENT, "info")["browser"] == client["browser"]
    before_reconnect = action(CLIENT, "journal")

    restart = monotonic()
    container("start", HOST)
    restarted_host = ready(HOST)
    browser_ready = monotonic()
    assert restarted_host["browser"] == host["browser"]
    assert action(CLIENT, "reset") is True
    negotiate()
    after = action(CLIENT, "read")
    assert after["value"]["value"] == before["value"]["value"]
    assert after["value"]["boot"] != before["value"]["boot"]
    recovered = monotonic()

    print(json.dumps({
        "engine": container("system", "version").strip(),
        "host": host, "client": client, "guestAddressesDistinct": True,
        "before": before,
        "suspension": {"browserProcesses": browser_processes, "whileSuspended": while_suspended,
                       "afterResume": after_resume, "suspensionMs": round((resumed - suspended) * 1000),
                       "recoveredAfterResumeMs": round((stop_started - resumed) * 1000)},
        "during": during, "after": after,
        "stopCommandMs": round((stopped - stop_started) * 1000),
        "unavailableObservedAfterStopMs": round((observed - stopped) * 1000),
        "browserReadyAfterRestartMs": round((browser_ready - restart) * 1000),
        "recoveredAfterRestartMs": round((recovered - restart) * 1000),
        "clientJournalBeforeReconnect": before_reconnect,
        "clientJournalAfterReconnect": action(CLIENT, "journal"),
    }, indent=2))
except subprocess.CalledProcessError as error:
    raise SystemExit(error.stderr or error.stdout or str(error)) from error
finally:
    for guest in reversed(created):
        subprocess.run([CLI, "stop", guest], capture_output=True, timeout=20, check=False)
        subprocess.run([CLI, "delete", guest], capture_output=True, timeout=20, check=False)
