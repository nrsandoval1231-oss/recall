"""Real Linux Tauri/WebKit workflow; no IPC mocks and no provider requests.

Run with a tauri-driver session recorded in /tmp/recall-webdriver-session.json.
A production frontend must be served at the configured debug URL. The native
app's RECALL_VAULT_DIR must point to a disposable synthetic test directory.
"""
import base64
import hashlib
import json
import os
import time
import urllib.request
from pathlib import Path

DRIVER = os.environ.get("RECALL_WEBDRIVER_URL", "http://127.0.0.1:4444")
SESSION_FILE = Path(os.environ.get("RECALL_WEBDRIVER_SESSION", "/tmp/recall-webdriver-session.json"))
ROOT = Path(os.environ.get("RECALL_RUNTIME_LIBRARY", "/tmp/recall-native-runtime/library"))
OUTPUT = Path(os.environ.get("RECALL_RUNTIME_EVIDENCE", "/src/test-results/native-library-editor/runtime"))
OUTPUT.mkdir(parents=True, exist_ok=True)
sid = json.loads(SESSION_FILE.read_text())["value"]["sessionId"]


def request(path, data=None, method="POST"):
    encoded = None if data is None else json.dumps(data).encode()
    req = urllib.request.Request(DRIVER + "/session/" + sid + path, data=encoded,
        method=method, headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=35).read())["value"]


def script(code, *args):
    return request("/execute/sync", {"script": code, "args": list(args)})


def wait(predicate, label):
    start = time.monotonic()
    while time.monotonic() - start < 25:
        if predicate():
            return
        time.sleep(0.15)
    raise AssertionError("Timed out: " + label + "\n" + str(script("return document.body.innerText")))


def element(selector):
    return request("/element", {"using": "css selector", "value": selector})["element-6066-11e4-a52e-4f735466cecf"]


def click(selector):
    request("/element/" + element(selector) + "/click", {})


def button(text):
    el = request("/element", {"using": "xpath", "value": "//button[normalize-space(.)=" + json.dumps(text) + "]"})["element-6066-11e4-a52e-4f735466cecf"]
    request("/element/" + el + "/click", {})


def write(selector, text):
    el = element(selector)
    request("/element/" + el + "/clear", {})
    request("/element/" + el + "/value", {"text": text, "value": [text]})


def screenshot(name):
    data = request("/screenshot", method="GET")
    (OUTPUT / (name + ".png")).write_bytes(base64.b64decode(data))


wait(lambda: script("return document.querySelector('.capture-center') !== null"), "actual Tauri frontend")
assert script("return '__TAURI_INTERNALS__' in window")
click("button[aria-label='Settings']")
button("Use default library")
wait(lambda: ROOT.joinpath("Recall/_meta/manifest.json").exists(), "native library creation")
click("button[aria-label='Settings']")
assert script("return document.querySelector('.ms-root').textContent.trim()") == str(ROOT), "Native app must target the disposable test library"
button("Close")
original = "SYNTHETIC NATIVE RUNTIME: Utility late? No firm deadline."
click(".capture-bubbles button[aria-label^='Write']")
write("#capture-note", original)
button("Save note")
wait(lambda: script("return document.querySelector('[data-testid=integrity]')?.textContent.includes('Hash matches')"), "real original evidence")
screenshot("native-created-memory")
ids = [p.name for p in ROOT.joinpath("Recall/History").iterdir()]
assert len(ids) == 1
memory_id = ids[0]
source = ROOT.joinpath("Recall/Sources", memory_id + ".txt")
assert source.read_bytes() == original.encode()
corrected = "SYNTHETIC HUMAN EDIT: Utility late? Deadline remains uncertain."
write(".memory-editor textarea", corrected)
wait(lambda: script("return document.querySelector('.editor-save [role=status]')?.textContent.startsWith('Saved in library')"), "actual native autosave")
assert source.read_bytes() == original.encode()
assert corrected in ROOT.joinpath("Recall/Memories", memory_id + ".md").read_text()
screenshot("native-autosaved-editor")
click("button[aria-label='Search']")
write("#recall-ask", "What happened with the utility delay?")
click("button[aria-label='Ask']")
wait(lambda: script("return document.body.innerText.includes('Source-backed matches')"), "native source-backed retrieval")
assert original in script("return document.body.innerText")
screenshot("native-source-backed-ask")
result = {"kind": "Actual Linux Tauri debug runtime + production frontend, real native filesystem; synthetic content; no IPC mocks, no live providers", "library_id": json.loads(ROOT.joinpath("Recall/_meta/manifest.json").read_text())["vault_id"], "memory_id": memory_id, "original_sha256": hashlib.sha256(source.read_bytes()).hexdigest(), "native_history_records": len(list(ROOT.joinpath("Recall/History", memory_id).iterdir())), "created_library": True, "captured_original": True, "autosaved_edit": True, "retrieved_original_quote": True}
(OUTPUT / "native-runtime.json").write_text(json.dumps(result, indent=2))
print(json.dumps(result))
