import type { PushOptions, TriggerMode } from 'cortico/core/types.ts';

/** Shared by the actual push calls and the human-facing event catalog. */
export const BOTTLE_EVENTS = {
  'bottle.request': {trigger:'flush',description:'人请求桌宠起草新信，立即投递；只起草，不代表确认寄出。'},
  'bottle.wake': {trigger:'flush',description:'写信、打捞与待办提醒的主动邀请，按既有间隔、次数、暂停与自主选择规则立即投递。'},
  'bottle.reading': {trigger:'flush',description:'人或控制端请求共读或起草回信，立即按对应意图单次递上原文。'},
  'bottle.peruse': {trigger:'flush',description:'人或控制端请求一起看归档往来，立即递上；只聊感想，不起草回信。'},
  'bottle.rewrite': {trigger:'flush',description:'人或控制端请求重写指定草稿，立即投递；不代表确认寄出。'},
  'bottle.note-request': {trigger:'flush',description:'人邀请桌宠起草或重写四十字小纸条，立即投递；人只确认寄出或放弃。'},
  'bottle.note-reading': {trigger:'flush',description:'人点击一起看小纸条，立即递上纸条与原往来，只读和聊感想。'},
  'bottle.headless-reading': {trigger:'flush',description:'仅无头模式：桌宠自行捞信后立即自主阅读并分享感想，正文仅在伙伴询问时转述；可起草手动回信，本轮禁寄。'},
  'bottle.mail': {trigger:'debounce',description:'新回信到达，按宿主的安静间隔合并通知；默认仅数量与相对时间；无头开启则投递正文供自主阅读，仅分享感想，询问时才转述。'},
  'bottle.note-arrived': {trigger:'debounce',description:'收到小纸条，合并投递纸条正文；无头下主动分享感想，伙伴询问时才转述正文，不附原往来、不授权起草。'},
  'bottle.sent': {trigger:'piggyback',description:'信件已经寄出，不单独唤醒，随下一批事件带入；不含正文。'},
  'bottle.dismissed': {trigger:'piggyback',description:'信件归还、沉底或收好后的结果，不单独唤醒，随下一批事件带入。'},
  'bottle.picked': {trigger:'piggyback',description:'寄出的信首次被捡起，随下一批事件告知，不单独唤醒、不带他人化名。'},
  'bottle.post': {trigger:'piggyback',description:'海边邮局系统邮件已放进信箱，随下一批事件告知；默认不递正文；无头下自主阅读并分享感想，询问时才转述，不能回信。'},
  'bottle.tsunami': {trigger:'piggyback',description:'海啸状态随下一批事件告知，不单独唤醒；运维重启原因不进入通知。'},
  'bottle.star-memory': {trigger:'piggyback',description:'人允许记住的星标往来随下一批事件递入；投递前重验授权，撤回后不递正文。'},
} as const satisfies Record<string,{trigger:TriggerMode;description:string}>;

export type BottleEventType = keyof typeof BOTTLE_EVENTS;
export function bottleEventOptions(type:BottleEventType):Pick<PushOptions,'trigger'> {
  return {trigger:BOTTLE_EVENTS[type].trigger};
}
