"""Actual Linux Tauri export/restore walkthrough. Requires dbus/GTK portal, X11 and a tauri-driver session. Synthetic disposable libraries only; no native IPC mocks."""
import subprocess,threading,time,zipfile,uuid
from pathlib import Path
exec((Path(__file__).with_name("library_editor_runtime.py")).read_text().split("wait(lambda: script")[0])
def picker(title,path):
 def run():
  try:
   start=time.monotonic()
   while time.monotonic()-start<25:
    found=subprocess.run(['xdotool','search','--name',title],env={**os.environ,'DISPLAY':':99'},capture_output=True,text=True)
    if found.returncode==0:
     window=found.stdout.strip().splitlines()[-1];env={**os.environ,'DISPLAY':':99'}
     subprocess.run(['xdotool','windowfocus',window],env=env,check=True);subprocess.run(['xdotool','key','ctrl+l'],env=env,check=True)
     subprocess.run(['xdotool','type','--clearmodifiers',path],env=env,check=True);subprocess.run(['xdotool','key','Return'],env=env,check=True);time.sleep(.8)
     remaining=subprocess.run(['xdotool','search','--onlyvisible','--name',title],env=env,capture_output=True,text=True)
     if remaining.returncode==0:
      subprocess.run(['xdotool','windowfocus',remaining.stdout.strip().splitlines()[-1]],env=env,check=True)
      subprocess.run(['xdotool','key','Return'],env=env,check=True)
     return
    time.sleep(.2)
   raise Exception('picker missing '+title)
  except Exception as e:print('picker failed',e,flush=True)
 thread=threading.Thread(target=run);thread.start();return thread
run_id=uuid.uuid4().hex
backup_stem=f"verified-library-backup-{run_id}"
restore_path=ROOT.parent/f"verified-restored-library-{run_id}"
wait(lambda:script("return document.querySelector('.ms')!==null"),'native app')
click("button[aria-label='Settings']")
selected=Path(script("return document.querySelector('.ms-root').textContent.trim()"))
assert selected.is_relative_to(ROOT.parent) and str(ROOT.parent).startswith('/tmp/recall-native-runtime'), "Use a disposable native runtime profile"
thread=picker('Export Recall library',str(ROOT.parent/(backup_stem+".zip")));button('Export library backup');thread.join()
wait(lambda:script("return document.body.innerText.includes('Exported')"),'export finished')
backups=list(ROOT.parent.glob(backup_stem+"*"));assert len(backups)==1;backup=backups[0];print('export',backup,flush=True);screenshot('native-library-export')
# Both restore pickers must be handled before waiting for the native command to finish.
first=picker('Restore a Recall library backup',str(backup));second=picker('Choose a new folder for the restored library',str(restore_path));button('Restore library backup');first.join();second.join()
restored=restore_path;wait(lambda:restored.joinpath('Recall/_meta/manifest.json').exists(),'restored library published')
original_manifest=json.loads(ROOT.joinpath('Recall/_meta/manifest.json').read_text());restored_manifest=json.loads(restored.joinpath('Recall/_meta/manifest.json').read_text());assert original_manifest==restored_manifest
with zipfile.ZipFile(backup) as z:
 manifest=json.loads(z.read('recall-library-backup.json'))
 for entry in manifest['entries']:
  assert hashlib.sha256(restored.joinpath(entry['path']).read_bytes()).hexdigest()==entry['sha256']
assert ROOT.joinpath('Recall/_meta/manifest.json').exists()
if script("return [...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Close')"):button("Close")
click("button[aria-label='Search']");write('#recall-ask','utility');click("button[aria-label='Ask']");wait(lambda:script("return document.body.innerText.includes('Source-backed matches')"),'restored native retrieval');button('Inspect original evidence');wait(lambda:script("return document.querySelector('.memory-editor')!==null"),'restored native editor');button('document.txt');wait(lambda:script("return document.body.innerText.includes('SYNTHETIC ATTACHMENT: inspection')"),'restored attachment');screenshot('native-library-restored-attachment')
result={'kind':'Actual Linux Tauri native backup and restore pickers, real native IPC and filesystem; synthetic content; no mocks','library_id':manifest['library_id'],'files_verified':len(manifest['entries']),'all_archived_hashes_match':True,'original_library_preserved':True,'restored_native_retrieval':True,'restored_native_editor':True,'restored_attachment_inspection':True,'backup_sha256':hashlib.sha256(backup.read_bytes()).hexdigest()};(OUTPUT/'native-backup-runtime.json').write_text(json.dumps(result,indent=2));print(json.dumps(result),flush=True)
