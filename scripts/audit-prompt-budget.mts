/** Reproducible context estimate using synthetic state, never real chat or letters. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {BOTTLE_TOOL_DECLS,BOTTLE_HEADLESS_TOOL_DECLS} from '../world/tools.ts';
import {BOTTLE_EVENTS} from '../world/events.ts';
import {estimateTokens} from 'cortico/core/util.ts';
import {makeHarness,callTool} from '../tests/helpers.ts';
import {FakeHost} from '../tests/fake-host.ts';
const measure=(text:string)=>({characters:[...text].length,utf8Bytes:Buffer.byteLength(text),estimatedTokens:estimateTokens(text)});
const tools=[...BOTTLE_TOOL_DECLS,...BOTTLE_HEADLESS_TOOL_DECLS].map(({name,description,parameters})=>({type:'function',name,description,parameters}));
const template=readFileSync(new URL('../world/ENV_PROMPT.md',import.meta.url),'utf8');
const h=makeHarness({port:0,config:{surface:'page',headlessEnabled:true}}),host=new FakeHost();
try{
 await h.world.start(host);await Reflect.get(h.world,'syncSea').call(h.world);
 const vars=h.world.envPromptVars();vars['bottle.page']='http://127.0.0.1:7796/';
 const environment=template.replace(/\{\{([^}]+)\}\}/g,(_,body)=>{const [key,...fallback]=body.split('|');return vars[key.trim()]||fallback.join('|').trim();});
 const eventSamples:Record<string,string>={};for(const action of ['write','catch','remind'])eventSamples[action]=Reflect.get(h.world,'wakeText').call(h.world,action);
 const toolResults:Record<string,ReturnType<typeof measure>>={doodleDirectory:measure(await callTool(h.world,'bottle_query_doodles')),emptyMailbox:measure(await callTool(h.world,'bottle_mailbox'))};
 const body='\u613f\u4f60\u4eca\u665a\u597d\u68a6\u3002';h.throwAs('audit-peer',body);await callTool(h.world,'bottle_catch');
 const event=(await host.deliverDeferred(h.world)).find(row=>row.type==='bottle.headless-reading');if(!event?.text)throw Error('Synthetic automatic-reading event missing');eventSamples.automaticReading=event.text;
 h.world.onTurnEnded();await callTool(h.world,'bottle_reply',{text:'\u8c22\u8c22\u4f60\u7684\u4fe1\u3002'});
 toolResults.draftDirectory=measure(await callTool(h.world,'bottle_list_drafts'));
 const draft=Reflect.get(h.world,'store').draft;if(!draft)throw Error('Synthetic reply draft missing');toolResults.draftView=measure(await callTool(h.world,'bottle_view_draft',{draftId:draft.draftId}));
 const withoutDescriptions=JSON.stringify(tools,(key,value)=>key==='description'?undefined:value);
 const report={scope:'Bottle only; synthetic empty mailbox; no private data; host heuristic, not model billing',estimator:'Cortico: CJK/full-width punctuation 0.6; other code points 0.3; round up. Provider framing, cached pricing and other plugins excluded.',toolCount:tools.length,eventTypeCount:Object.keys(BOTTLE_EVENTS).length,
  tools:measure(JSON.stringify(tools)),schemaWithoutDescriptions:measure(withoutDescriptions),toolDescriptions:measure(tools.map(t=>t.description).join('\n')),
  environment:measure(environment),fixedTotal:measure(JSON.stringify(tools)+'\n'+environment),
  events:Object.fromEntries(Object.entries(eventSamples).map(([kind,text])=>[kind,measure(text)])),eventCatalog:{...measure(JSON.stringify(BOTTLE_EVENTS)),injectedIntoModel:false},
  perTool:tools.map(tool=>({name:tool.name,...measure(JSON.stringify(tool))})),
  texts:{template,environment,eventSamples,tools},toolResults,autoReadingBody:measure(body)};
 const path=resolve(process.argv[2]??'artifacts/validation/bottle-prompt-before-20261116.json');mkdirSync(dirname(path),{recursive:true});writeFileSync(path,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({path,toolCount:report.toolCount,eventTypeCount:report.eventTypeCount,tools:report.tools,environment:report.environment,fixedTotal:report.fixedTotal,events:report.events}));
}finally{await h.stop();}
