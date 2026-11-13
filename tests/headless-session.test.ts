import { afterEach, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { createBot, type Bot, type BotDefinition } from 'cortico/bot.ts';
import { CORE_DEFAULTS, type LoadedConfig } from 'cortico/core/config.ts';
import type { Generation, GenerateOptions, ResponseClient } from 'cortico/core/generation.ts';
import type { BlobStore, CoreApi, CoreConfig, Persona, SessionDecl, ToolDef, World, WorldHost } from 'cortico/core/types.ts';
import { createResponse, type Request } from 'cortico/protocol/open-responses/index.ts';
import { withWorlds, type WorldDefinition, type WorldSection } from 'cortico/world.ts';
import { BOTTLE } from '../world/definition.ts';
import { makeHarness, type Harness } from './helpers.ts';

let h: Harness | undefined, bot: Bot<CoreConfig> | undefined;
afterEach(async()=>{await bot?.stop();bot=undefined;await h?.stop();h=undefined;});

class SessionPersona implements Persona {
  readonly blobs: BlobStore = {put:()=> 'mem:test',get:()=>null,list:()=>[]};
  constructor(readonly memoryDir:string,private readonly worlds:readonly World[]){}
  attach(_core:CoreApi):void{}
  async systemSegments(){return [{title:'Test',text:'Synthetic regression test. Never contact real people.'}];}
  declareSessions():SessionDecl[]{
    const end:ToolDef={name:'end_turn',description:'End this turn.',tags:['flow'],endsTurn:true,barrierAfter:true,
      parameters:{type:'object',properties:{}},handler:async()=> '[turn ended]'};
    return [{id:'main',label:'test',rounds:()=>({soft:10,hard:20}),persistent:true,receivesEvents:true,
      tools:()=>[...this.worlds.flatMap(world=>world.tools()),end]}];
  }
  ownToolNames(){return ['end_turn'];}
}

it.each(['automatic','later-chat-request'] as const)('a real Core session supports %s reply, review and later confirmed sending after a live toggle',async(replyMode)=>{
  h=makeHarness({port:0,config:{enabled:true,headlessEnabled:false,randomWake:false}});
  const harness=h,store=Reflect.get(harness.world,'store');
  let driver:WorldHost|undefined;
  let phase='idle',responses=0;
  const seen:Array<{tools:string[];context:string}>=[];
  const model:ResponseClient={respond:async(request:Request,options:GenerateOptions={}):Promise<Generation>=>{
    seen.push({tools:(request.tools??[]).map(t=>(t as {name?:string}).name??''),context:JSON.stringify(options.context??[])});
    let name='end_turn',args:Record<string,unknown>={};
    if(phase==='catch'){name='bottle_catch';phase=replyMode==='automatic'?'reply':'end';}
    else if(phase==='reply'){name='bottle_reply';args={text:'只存在测试中的回信。'};phase='blocked';}
    else if(phase==='requested-reply'){name='bottle_reply';args={text:'只存在测试中的回信。'};phase='end';}
    else if(phase==='blocked'){name='bottle_send_draft';args={draftId:store.draft?.draftId,revision:store.draft?.revision};phase='end';}
    else if(phase==='list'){name='bottle_list_drafts';phase='view';}
    else if(phase==='view'){name='bottle_view_draft';args={draftId:store.draft?.draftId};phase='send';}
    else if(phase==='send'){name='bottle_send_draft';args={draftId:store.draft?.draftId,revision:store.draft?.revision};phase='end';}
    else if(phase==='disabled'){name='bottle_list_drafts';phase='end';}
    else phase='idle';
    const response=createResponse('test_response_'+(++responses),request);
    response.status='completed';
    response.output=[{type:'function_call',id:'fc_'+responses,call_id:'call_'+responses,name,arguments:JSON.stringify(args),status:'completed'}];
    const origin={instance:'test',module:'test',model:'test',compatibilityDomain:'test'};
    return {response,origin,attempts:[{id:'attempt_'+responses,generationId:response.id,ordinal:0,origin,
      startedAt:new Date().toISOString(),elapsedMs:0,requestId:null,responseId:response.id,outcome:'completed',status:200,
      serviceTier:null,charges:[],meters:{input:null,output:null,total:null,cachedInput:null,uncachedInput:null,reasoning:null,native:null}}]} as Generation;
  }};
  const driverDefinition:WorldDefinition<WorldSection>={id:'testdriver',label:'test',defaults:()=>({enabled:false}),create:()=>({
    id:'testdriver',tools:()=>[],envPromptVars:()=>null,start:async host=>{driver=host;},stop:async()=>{},
  })};
  const base:BotDefinition<CoreConfig>={id:'headless-regression',declares:['bottle','testdriver'],defaults:()=>({
    ...CORE_DEFAULTS,displayName:'test',providers:{scripted:{kind:'openai-responses-compat',baseUrl:'https://model.test',spec:{model:'test',thinking:false},multimodal:true}},
    activeProvider:'scripted',paths:{memory:'memory',data:'data'},web:{port:0,theme:'mint'},
  } as CoreConfig),build:(loaded,worlds)=>({persona:new SessionPersona(loaded.memoryDir,worlds),llm:model,console:{enabled:false}})};
  const definition=withWorlds(base,[{...BOTTLE,create:()=>harness.world} as WorldDefinition<WorldSection>,driverDefinition]);
  const loaded:LoadedConfig<CoreConfig>={config:definition.defaults(),secret:name=>name==='CORTICO_WEB_PASSWORD'?'':'test-key',
    rootDir:harness.dir,memoryDir:join(harness.dir,'memory'),dataDir:join(harness.dir,'core-data')};
  bot=createBot(loaded,definition);await bot.start();
  const request=async(text='A synthetic partner request.')=>{
    const before=responses;
    await driver!.pushEvent({type:'test.request',source:'testdriver',origin:'external',senderKey:'synthetic-partner',
      ts:new Date().toISOString(),text},{trigger:'flush'});
    await vi.waitFor(()=>{expect(responses).toBeGreaterThan(before);expect(phase).toBe('idle');},{timeout:5000});
    await vi.waitFor(()=>expect(Reflect.get(harness.world,'phase')).toBe('idle'),{timeout:5000});
  };
  await request();
  const initialTools=seen[0].tools;
  for(const name of ['bottle_reply','bottle_read_letter','bottle_list_drafts','bottle_view_draft','bottle_send_draft'])expect(initialTools).toContain(name);
  harness.cfg.headlessEnabled=true;
  const id=harness.throwAs('test-peer','测试原文，仅用于合成会话。');
  phase='catch';await request();
  if(replyMode==='later-chat-request'){
    expect(store.draft).toBeNull();
    phase='requested-reply';await request('#100001 这封你回吧');
  }
  expect(store.draft).toMatchObject({letterId:id,sendPolicy:'manual',body:'只存在测试中的回信。'});
  expect(harness.db.replies).toHaveLength(0);
  if(replyMode==='automatic')expect(seen.some(turn=>turn.context.includes('不能寄出'))).toBe(true);
  expect(seen.some(turn=>turn.context.includes('测试原文，仅用于合成会话。'))).toBe(true);
  phase='list';await request('我看过这份回信了，确认寄出。');
  expect(harness.db.replies).toHaveLength(1);expect(store.draft).toBeNull();
  for(const turn of seen)expect(turn.tools).toEqual(initialTools);
  harness.cfg.headlessEnabled=false;phase='disabled';await request();
  expect(seen.at(-1)!.context).toContain('无头模式未开启');
},15000);
