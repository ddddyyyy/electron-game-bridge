// Scan committed objects, not ignored local data; never print matched secret values.
const cp=require('child_process');
const path=require('path');
const assert=require('assert');
const root=path.resolve(__dirname,'..');
const git=(args)=>cp.execFileSync('git',['-C',root].concat(args),{maxBuffer:16*1024*1024});
const commits=git(['rev-list','--all']).toString().trim().split('\n').filter(Boolean);
assert(commits.length,'Create the sanitized initial commit before auditing');
const forbidden=/^(?:runtime|Game|games|logs|\.userdata|\.test-saves|\.test-launcher|\.launcher|\.codex|\.aws|\.codegraph)\/|(?:^|\/)\.env(?:\.|$)|\.(?:sav|dmp|heapsnapshot|cpuprofile)$/i;
const personalPath=/(?:\/Users\/|\/home\/)[A-Za-z0-9._-]+\/|[A-Z]:\\Users\\[A-Za-z0-9._-]+\\/;
const credential=/gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[A-Z0-9]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;
const checked=new Set(),problems=[];
for(const commit of commits){
  const entries=git(['ls-tree','-rz',commit]).toString().split('\0').filter(Boolean);
  for(const entry of entries){
    const tab=entry.indexOf('\t'),name=entry.slice(tab+1),head=entry.slice(0,tab).split(' '),object=head[2];
    if(forbidden.test(name))problems.push(name+': local/generated artifact');
    if(checked.has(object))continue;checked.add(object);
    if(Number(git(['cat-file','-s',object]).toString())>1024*1024){problems.push(name+': large object requires manual review');continue;}
    const data=git(['cat-file','blob',object]).toString('utf8');
    if(personalPath.test(data))problems.push(name+': user home path');
    if(credential.test(data))problems.push(name+': credential candidate');
  }
  const metadata=git(['show','-s','--format=%an%n%ae%n%cn%n%ce',commit]).toString().trim().split('\n');
  for(const email of [metadata[1],metadata[3]])if(!email.endsWith('@example.invalid')&&!email.endsWith('@users.noreply.github.com'))problems.push('commit metadata: non-anonymous email');
}
if(problems.length){console.error(Array.from(new Set(problems)).join('\n'));process.exitCode=1;}
else console.log('PASS publication audit: '+commits.length+' commits, '+checked.size+' unique objects; no flagged paths, generated data or credential patterns');
