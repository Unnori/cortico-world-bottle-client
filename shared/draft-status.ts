/** Human-visible status shared by all local entry points; send policy stays unchanged. */
export type DraftStatus='待确认'|'已安排定时寄出'|'补寄中'|'已失效';
export function draftStatus(draft:{sendFailure?:string;autoSendAt?:number},now=Date.now()):DraftStatus {
  if(draft.sendFailure)return '已失效';
  if(draft.autoSendAt)return now>=draft.autoSendAt?'补寄中':'已安排定时寄出';
  return '待确认';
}
