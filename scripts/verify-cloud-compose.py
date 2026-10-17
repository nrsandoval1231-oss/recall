"""Synthetic verification of the isolated megraph-check Compose project only."""
import argparse
import os
import subprocess
import time
import urllib.error
import urllib.request

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--env-file", required=True)
parser.add_argument("--override", required=True, help="Compose override selecting the locally built web image")
args = parser.parse_args()
compose = ["docker", "compose", "--env-file", args.env_file, "-f", "infra/megraph/compose.yml",
           "-f", args.override, "-p", "megraph-check"]
# The operator token stays inside the API container; the short-lived enrollment
# is passed privately to the browser subprocess, never printed or written to evidence.
issue = '''import json,os,urllib.request
request=urllib.request.Request("http://127.0.0.1:8000/v1/operator/enrollments",data=b"{}",headers={"Authorization":"Bearer "+os.environ["RECALL_OPERATOR_TOKEN"],"Content-Type":"application/json"})
print(json.load(urllib.request.urlopen(request))["enrollment_token"])'''
token = subprocess.check_output(compose + ["exec", "-T", "api", "python", "-c", issue], text=True).strip()
subprocess.run(["node", "apps/desktop/scripts/verify-cloud.mjs"], check=True,
               env={**os.environ, "MEGRAPH_TEST_ENROLLMENT": token,
                    "MEGRAPH_TEST_ORIGIN": "http://127.0.0.1:18880", "MEGRAPH_TEST_PWA": "1"})


def snapshot():
    return subprocess.check_output(compose + ["exec", "-T", "db", "psql", "-U", "postgres", "-d", "recall", "-At", "-c",
        "select id,revision,md5(note),source_sha256 from library_documents order by workspace_id,id"], stderr=subprocess.DEVNULL)


before = snapshot()
assert before
subprocess.run(compose + ["restart", "db", "api", "worker"], check=True,
               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for attempt in range(60):
    try:
        if snapshot() == before:
            urllib.request.urlopen("http://127.0.0.1:18880/v1/library/status", timeout=2)
    except urllib.error.HTTPError as error:
        if error.code == 401:
            break
    except (OSError, subprocess.CalledProcessError):
        pass
    time.sleep(1)
else:
    raise RuntimeError("Restart recovery did not finish")
assert snapshot() == before
print("PASS: isolated database/API/worker restart preserved records, revisions and source hashes; anonymous access refused")
