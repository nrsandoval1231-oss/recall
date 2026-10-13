"""Explicit synthetic-only live provider probe; configuration arrives over stdin, never printed."""
import asyncio
import json
import os
import sqlite3
import sys
from pathlib import Path

config = json.loads(sys.stdin.readline())
os.environ.update(config)
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'services/backend/src'))
from recall.knowledge.providers import configured_clients, configure_budget_path
from graphiti_core.prompts.models import Message
from pydantic import BaseModel

class Extracted(BaseModel):
    subject: str
    relation: str
    object: str

async def run():
    ledger = Path('/home/nrsan/.local/share/recall-graphiti-verification/graph.db.budget.sqlite')
    configure_budget_path(ledger)
    llm, _ = configured_clients()
    try:
        result = await llm.generate_response([
            Message(role='system', content='Extract the explicitly stated relationship from the synthetic note using the supplied schema. No real people or private data are involved.'),
            Message(role='user', content='Synthetic test: Fictional Alice works on Project Aurora.')
        ], Extracted, max_tokens=512)
        print(json.dumps({'state':'PASS','result':result}))
    except Exception as error:
        print(json.dumps({'state':'FAIL','error_type':type(error).__name__,'message':str(error)[:1500]}))
        raise SystemExit(1)
    finally:
        with sqlite3.connect(ledger) as db:
            print(json.dumps({'budget':db.execute('select reserved_usd,spent_usd from provider_budget').fetchall(), 'calls':db.execute('select status,input_tokens,output_tokens,actual_usd from provider_calls').fetchall()}))

asyncio.run(run())
