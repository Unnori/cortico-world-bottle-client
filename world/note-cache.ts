import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { NOTE_TTL_MS, type ReceivedNote } from '../shared/contract.ts';
import { checkNote } from '../shared/text.ts';

/** expiresAt describes server retention only; it never expires this local copy. */
export interface LocalNote extends ReceivedNote { readAt?: number }
interface ForgottenNote { id:string; letterId:string; expiresAt:string }

/** Local archive: body and readAt remain until the human deletes the correspondence or
 * clears the letterbook. Server expiry is transport metadata, never a local deadline.
 * Body-free deletion receipts prevent a failed server ACK from restoring removed notes;
 * these receipts alone expire at the server's original seven-day deadline.
 * Neither notes nor these receipts are included in letterbook exports or star memory. */
export class NoteCache {
  readonly file:string;
  private records = new Map<string,LocalNote>();
  private forgotten = new Map<string,ForgottenNote>();
  constructor(dir:string,private readonly now:()=>number){this.file=join(dir,'bottle-notes.json');}
  load():void {
    this.records.clear();this.forgotten.clear();
    try {
      const data=JSON.parse(readFileSync(this.file,'utf8'));
      if(data.schemaVersion!==1)return;
      for(const value of Array.isArray(data.notes)?data.notes:[]) {
        const note=this.valid(value);if(!note)continue;
        this.records.set(note.id,{...note,...(typeof value.readAt==='number'&&Number.isFinite(value.readAt)&&value.readAt>0?{readAt:value.readAt}:{})});
      }
      for(const value of Array.isArray(data.forgotten)?data.forgotten:[]){
        if(value&&this.id(value.id)&&this.id(value.letterId)&&typeof value.expiresAt==='string'&&Date.parse(value.expiresAt)>this.now()){
          this.forgotten.set(value.id,{id:value.id,letterId:value.letterId,expiresAt:value.expiresAt});this.records.delete(value.id);
        }
      }
      // Migrate older seven-day caches without expiring any locally archived paper.
      this.save();
    } catch(error) { if(existsSync(this.file)&&!(error instanceof SyntaxError))throw error; }
  }
  private id(value:unknown):value is string{return typeof value==='string'&&value.length>0&&value.length<=256;}
  private valid(value:unknown,fromServer=false):ReceivedNote|null {
    if(!value||typeof value!=='object')return null;
    const n=value as Record<string,unknown>;
    if(!this.id(n.id)||!this.id(n.letterId)||typeof n.from!=='string'||typeof n.body!=='string'||!checkNote(n.body).ok||typeof n.at!=='string'||typeof n.expiresAt!=='string')return null;
    const at=Date.parse(n.at),expires=Date.parse(n.expiresAt);
    if(!Number.isFinite(at)||!Number.isFinite(expires)||(fromServer&&expires<=this.now())||expires<=at||expires>at+NOTE_TTL_MS)return null;
    return {id:n.id,letterId:n.letterId,from:n.from,body:n.body,at:n.at,expiresAt:n.expiresAt};
  }
  receive(value:unknown):string|null {
    const note=this.valid(value,true);if(!note)return null;
    // Save even an existing note again before ACK: a previous disk write may have failed.
    const added=!this.forgotten.has(note.id)&&!this.records.has(note.id);
    if(added)this.records.set(note.id,note);
    try{this.save();}catch(error){if(added)this.records.delete(note.id);throw error;}return note.id;
  }
  all():LocalNote[]{this.prune();return [...this.records.values()].map(n=>({...n})).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));}
  get(id:string):LocalNote|undefined{this.prune();const note=this.records.get(id);return note?{...note}:undefined;}
  read(id:string):void {
    const note=this.records.get(id);if(!note)return;
    if(!note.readAt)note.readAt=this.now();this.save();
  }
  forget(letterId?:string):void {
    for(const [id,note] of this.records){if(letterId&&note.letterId!==letterId)continue;
      this.forgotten.set(id,{id,letterId:note.letterId,expiresAt:note.expiresAt});this.records.delete(id);
    }
    this.prune();this.save();
  }
  prune():void {
    let changed=false;
    for(const [id,note] of this.forgotten){if(Date.parse(note.expiresAt)<=this.now()){this.forgotten.delete(id);changed=true;}}
    if(changed)this.save();
  }
  private save():void {
    mkdirSync(dirname(this.file),{recursive:true});const temporary=this.file+'.tmp';
    try{writeFileSync(temporary,JSON.stringify({schemaVersion:1,notes:[...this.records.values()],forgotten:[...this.forgotten.values()]})+'\n',{encoding:'utf8',mode:0o600});renameSync(temporary,this.file);}
    finally{try{unlinkSync(temporary);}catch{/* No partial note bodies left in a temporary file. */}}
  }
}
