"""Real Graphiti synthetic ingestion/retrieval probe; no application mocks."""
import asyncio,json,os,sys,hashlib,sqlite3,traceback
from datetime import datetime,timezone
from pathlib import Path
os.environ.update(json.loads(sys.stdin.readline()))
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'services/backend/src'))
from recall.knowledge.graph import GraphAdapter
from recall.knowledge.models import Snapshot,Source

async def run():
    path='/home/nrsan/.local/share/recall-graphiti-verification/graph.db'
    text='Synthetic test only. Fictional Alice Chen works on Project Aurora for Example Labs.'
    digest=hashlib.sha256(text.encode()).hexdigest()
    source=Source(id='11111111-1111-4111-8111-111111111111',revision=1,source_sha256=digest,note_sha256=digest,text=text,source_name='synthetic.txt',note_path='synthetic.md',captured_at=datetime.now(timezone.utc),updated_at=datetime.now(timezone.utc))
    snap=Snapshot(version=1,scope='22222222-2222-4222-8222-222222222222',generation=1,processing_allowed=True,sources=[source],eligible_ids=[source.id],suppressed_facts=[],rebuild=True)
    graph=GraphAdapter(path)
    try:
        if os.environ.get('RECALL_PROBE_MODE') != 'search-only':
            await graph.rebuild(snap)
        hits=await graph.search(snap.scope,'Project Aurora',20,{source.id:source})
        print(json.dumps({'state':'PASS' if hits else 'EMPTY','relationships':[h.model_dump(mode='json') for h in hits]}),flush=True)
        assert hits, 'Real graph retrieval returned no eligible relationships'
        assert all(s.quote in text and s.source_id == source.id for h in hits for s in h.supports)
        listed=await graph.search(snap.scope,'',50,{source.id:source})
        assert listed, 'Real persisted relationship exploration was empty'
        foreign=await graph.search('33333333-3333-4333-8333-333333333333','',50,{source.id:source})
        assert not foreign, 'Scope isolation failed'
        stale=await graph.search(snap.scope,'',50,{})
        assert not stale, 'Unknown source must suppress every relationship'
        print(json.dumps({'checks':'PASS','persisted_exploration':len(listed),'foreign_scope':len(foreign),'unknown_sources':len(stale)}),flush=True)
    except Exception as e:
        traceback.print_exc()
        print(json.dumps({'state':'FAIL','error_type':type(e).__name__}),flush=True)
        raise SystemExit(1)
    finally:
        await graph.close()
        with sqlite3.connect(path+'.budget.sqlite') as db:
            print(json.dumps({'budget':db.execute('select reserved_usd,spent_usd from provider_budget').fetchall(),'calls':db.execute('select status,input_tokens,output_tokens,actual_usd from provider_calls').fetchall()}),flush=True)
asyncio.run(run())
