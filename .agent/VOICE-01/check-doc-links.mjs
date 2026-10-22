import fs from 'node:fs';
import process from 'node:process';
import console from 'node:console';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root=process.cwd();
const files=[...new Set([...execFileSync('git',['diff','--name-only','--diff-filter=ACM'],{encoding:'utf8'}).trim().split('\n'),...execFileSync('git',['ls-files','--others','--exclude-standard'],{encoding:'utf8'}).trim().split('\n')])].filter(f=>f.endsWith('.md')&&!f.includes('/archive/'));
const broken=[];
for(const file of files){
 const content=fs.readFileSync(path.join(root,file),'utf8');
 for(const match of content.matchAll(/\]\((?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\)/g)){
  const target=(match[1]??match[2]).split('#')[0];
  if(!target||/^[a-z]+:/i.test(target)||target.startsWith('/'))continue;
  if(!fs.existsSync(path.resolve(root,path.dirname(file),decodeURIComponent(target))))broken.push({file,target});
 }
}
const result={checked:files.length,broken,scope:'Changed active Markdown links; historical archives excluded; anchor existence not checked',checked_at:new Date().toISOString()};
fs.writeFileSync('.agent/VOICE-01/docs-links.json',JSON.stringify(result,null,2)+'\n');
console.warn(JSON.stringify(result));
process.exitCode=broken.length?1:0;


