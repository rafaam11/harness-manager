import fs from "node:fs/promises";
import path from "node:path";

/** Intercept CLI discovery and execution so no installed CLI, account or model is used by E2E. */
export async function writeElectronFixture(entry: string) {
  const root = path.dirname(entry), worker = path.join(root, "cli-worker.cjs");
  await fs.writeFile(worker, String.raw`
const fs=require('fs'),path=require('path'),readline=require('readline');
const args=process.argv.slice(2),provider=args.shift();
if(args.includes('--version')){console.log(provider==='codex'?'codex-cli 0.166.0':'2.1.318 (Claude Code)');process.exit(0)}
if(args.includes('--help')){console.log('--bare --restricted --tools --disallowedTools --strict-mcp-config --max-budget-usd --no-session-persistence --model');process.exit(0)}
if(args.includes('app-server')){
readline.createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);if(m.method==='initialize')console.log(JSON.stringify({id:m.id,result:{}}));
 if(m.method==='skills/list'){
 const skills=[],dir=path.join(process.env.HM_CODEX_HOME,'skills');
 for(const name of fs.existsSync(dir)?fs.readdirSync(dir):[]){const file=path.join(dir,name,'SKILL.md');if(fs.existsSync(file))skills.push({name,description:'fixture',path:file,scope:'user',enabled:true})}
 const plugin=path.join(process.env.HM_CODEX_HOME,'fixture-plugin','SKILL.md');if(fs.existsSync(plugin))skills.push({name:'same',description:'CLI-only plugin skill',path:plugin,scope:'user',enabled:false,pluginId:'fixture@market'});
 const project=path.join(m.params.cwds[0],'.agents','skills','project-only','SKILL.md');if(fs.existsSync(project))skills.push({name:'project-only',description:'Project skill',path:project,scope:'repo',enabled:true});
 console.log(JSON.stringify({id:m.id,result:{data:[{cwd:m.params.cwds[0],skills,errors:[]}]}}));}
});
}else if(provider==='claude'&&args.includes('--print')&&args.includes('--bare')&&args.includes('--restricted')&&args.includes('--disallowedTools')){
 let text='';process.stdin.on('data',chunk=>text+=chunk);process.stdin.on('end',()=>{const result=text.startsWith('Create one harmless')?{description:'텍스트 요약 예제',input:'샘플 문장',expectedArtifact:'요약 텍스트',tools:[],connections:[],checks:[{type:'contains',text:'요약'}]}:{artifact:'요약: 샘플 문장'};console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,result:JSON.stringify(result)}))});
}else{process.stderr.write('Unexpected CLI invocation in E2E');process.exit(1)}
`);
  const appEntry = path.resolve("out/main/index.js");
  const version = JSON.parse(await fs.readFile("package.json", "utf8")).version;
  await fs.writeFile(entry, `
const {BrowserWindow,app}=require('electron');
const cp=require('child_process'),util=require('util'),path=require('path');
const originalExec=cp.execFile,originalAsync=util.promisify(originalExec),originalSpawn=cp.spawn;
const cli=file=>/^(codex|claude)(?:\\.exe)?$/i.exec(path.basename(file))?.[1];
const patched=(file,args,options,callback)=>{const name=cli(file);if(name&&args.includes('--version')){queueMicrotask(()=>callback(null,name==='codex'?'codex-cli 0.166.0':'2.1.318 (Claude Code)',''));return;}return originalExec(file,args,options,callback);};
patched[util.promisify.custom]=async(file,args,...rest)=>{
 if(file==='tasklist')return {stdout:'',stderr:''};
 if(file==='pgrep'){const e=new Error('none');e.code=1;throw e;}
 if((file==='where.exe'||file==='which')&&cli(args[0]))return {stdout:path.join(${JSON.stringify(root)},cli(args[0])+(process.platform==='win32'?'.exe':'')),stderr:''};
 return originalAsync(file,args,...rest);
};cp.execFile=patched;
cp.spawn=(file,args,options)=>{const name=cli(file);if(name)return originalSpawn(process.execPath,[${JSON.stringify(worker)},name,...args],{...options,env:{...options.env,ELECTRON_RUN_AS_NODE:'1'}});return originalSpawn(file,args,options);};
app.getVersion=()=>${JSON.stringify(version)};
BrowserWindow.prototype.show=function(){};BrowserWindow.prototype.showInactive=function(){};
require(${JSON.stringify(appEntry)});`);
}
