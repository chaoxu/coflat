import { test, expect, type Locator, type Page } from "@playwright/test";
async function setDoc(p: Page, doc: string){await p.evaluate((d)=>{const e=(window as any).__coflatEditor;e.setDoc(d);e.setMode("rich");},doc);}
async function settle(p: Page){await p.evaluate(async()=>{await (document as any).fonts.ready;await new Promise<void>(r=>requestAnimationFrame(()=>r()));await new Promise<void>(r=>requestAnimationFrame(()=>r()));});}
async function rectOf(loc: Locator, t: string){return loc.evaluate((el,t)=>{const w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let n=w.nextNode();while(n){const v=n.nodeValue??"";const i=v.indexOf(t);if(i>=0){const r=document.createRange();r.setStart(n,i);r.setEnd(n,i+t.length);const c=r.getClientRects()[0];if(!c)throw new Error("norect");return{left:c.left,top:c.top,height:c.height,width:c.width};}n=w.nextNode();}throw new Error("notext "+t);},t);}
async function drag(p: Page, loc: Locator, a: string, b: string){const s=await rectOf(loc,a),e=await rectOf(loc,b);await p.mouse.move(s.left+2,s.top+s.height/2);await p.mouse.down();await p.mouse.move(e.left+e.width-2,e.top+e.height/2,{steps:8});await p.mouse.up();await settle(p);}
async function sel(p: Page){return p.evaluate(()=>{const v=(window as any).__coflatEditorView;if(!v)return"";const{from,to}=v.state.selection.main;return v.state.sliceDoc(from,to);});}
const DOC="---\nid: ztrcpji2\n---\n\nmotivated by a workshop question with enough rendered words to drag.\n\nsecond paragraph with plenty of words to drag here.\n";
test("#200 first line after frontmatter is mouse-drag selectable", async ({page})=>{
  await page.goto("/tests/e2e/fixtures/index.html"); await setDoc(page,DOC); await settle(page);
  const first=page.locator(".cm-line",{hasText:"motivated by a workshop"}).first();
  await drag(page, first, "motivated", "drag");
  await expect.poll(()=>sel(page)).toContain("motivated by a workshop");
});
