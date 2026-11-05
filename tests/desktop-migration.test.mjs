import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { ReviewStore } from '../desktop/review-store.mjs';
import { prepareImport, applyImport, exportProject } from '../desktop/data-transfer.mjs';
import { DesktopUpdates } from '../desktop/updates.mjs';
import { interruptedFlows } from '../desktop/flow-data.mjs';
import { newRun } from '../companion/core.mjs';
import { pageCommand } from '../desktop/cdp.mjs';
import { chromium } from 'playwright';
import { mappedPreparation } from '../desktop/mappings.mjs';
import { browserEvidence } from '../companion/interaction.mjs';
import { installRecorder } from '../desktop/recorder.mjs';
const devices=[{id:'phone',name:'Phone',width:393,height:852,mobile:true}];
const profile={id:'general',name:'Review',prompt:'Review',categories:['Accessibility'],devices:['phone'],ai:false,fullPage:true,masks:'',exportPdf:false};

test('clicking an already-focused field still identifies the interaction source',async()=>{
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage();const actions=[];
  await page.exposeFunction('atlasTestAction',raw=>actions.push(JSON.parse(raw)));
  await page.setContent('<label for="name">Name</label><input id="name" value="Prepared field">');
  await page.evaluate(`(${installRecorder})(${browserEvidence},'atlasTestAction')`);
  await page.locator('#name').focus();
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));actions.length=0;
  await page.locator('#name').click();
  assert(actions.some(action=>action.type==='focus'),'A direct field click must identify its source even when DOM focus is already prepared');
 }finally{await browser.close();}
});

test('a trusted DOM drop records its outcome without treating the trailing click as an independent action',async()=>{
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage();const actions=[];
  await page.exposeFunction('atlasTestAction',raw=>actions.push(JSON.parse(raw)));
  await page.setContent('<div id="item" draggable="true" style="width:80px;height:40px">Move item</div><div id="destination" style="margin-top:30px;width:200px;height:100px">Drop here</div>');
  await page.evaluate(`(${installRecorder})(${browserEvidence},'atlasTestAction')`);
  await page.evaluate(()=>{document.querySelector('#destination').addEventListener('dragover',event=>event.preventDefault());document.querySelector('#destination').addEventListener('drop',event=>{event.preventDefault();event.currentTarget.append(document.querySelector('#item'));});});
  const source=await page.locator('#item').boundingBox(),destination=await page.locator('#destination').boundingBox();
  await page.mouse.move(source.x+5,source.y+5);await page.mouse.down();
  const cdp=await page.context().newCDPSession(page);
  for(const type of ['dragEnter','dragOver','drop'])await cdp.send('Input.dispatchDragEvent',{type,x:destination.x+5,y:destination.y+5,data:{items:[{mimeType:'text/plain',data:'item'}],dragOperationsMask:1}});
  await page.mouse.move(destination.x+5,destination.y+5);await page.mouse.up();
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));
  assert(actions.some(action=>action.type==='drag'&&action.contents.includes('item')),'The completed drop was not recorded');
  assert(!actions.some(action=>action.type==='blocked'),'A successful drop was mistaken for an unidentified click');
 }finally{await browser.close();}
});

test('mapped responsive menus prepare once and revalidate the controlled target',async()=>{
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage();
  await page.setContent('<button id="toggle" type="button" aria-controls="menu" aria-expanded="false" onclick="this.setAttribute(\'aria-expanded\',\'true\');window.opened=(window.opened||0)+1">Open menu</button><nav id="menu"><button id="item" type="button">Show options</button></nav><button id="unrelated" type="button">Other options</button>');
  const apply=selector=>page.evaluate(`(${mappedPreparation})(${JSON.stringify({source:'source',viewId:'phone',selector,prepare:'#toggle'})},'',${browserEvidence},true)`);
  await apply('#item');await apply('#item');assert.equal(await page.evaluate(()=>window.opened),1);
  await assert.rejects(apply('#unrelated'),/does not control/);
  await page.locator('#toggle').evaluate(el=>{el.textContent='Purchase';el.setAttribute('aria-expanded','false');});
  await assert.rejects(apply('#item'),/private or consequential/);
  await page.setContent('<div id="editor" contenteditable="true" aria-label="Editor"><strong>Keep formatting</strong></div>');
  const result=await page.evaluate(`(()=>{const evidence=${browserEvidence};return evidence({type:'edit',desktop:true,descriptor:evidence({type:'describe-element',desktop:true,element:document.querySelector('#editor')}),value:'Replacement'});})()`);
  assert.equal(result.ok,false);assert.match(await page.locator('#editor').innerHTML(),/<strong>Keep formatting<\/strong>/);
 }finally{await browser.close();}
});

test('page commands time out and cancellation before dispatch never repeats an uncertain operation',async()=>{
 let calls=0,complete;
 const entry={view:{webContents:{debugger:{sendCommand:()=>{calls++;return new Promise(resolve=>{complete=resolve;});}}}}};
 await assert.rejects(pageCommand(entry,'Runtime.evaluate',{}, {timeout:5}),/outcome is uncertain/);
 assert.equal(calls,1);complete({late:true});
 const controller=new AbortController();
 const cancelled=pageCommand(entry,'Input.dispatchKeyEvent',{}, {signal:controller.signal});
 controller.abort(new Error('Cancelled by reviewer'));
 await assert.rejects(cancelled,/Cancelled by reviewer/);assert.equal(calls,1);
 assert.throws(()=>pageCommand(entry,'Runtime.evaluate',{}, {signal:controller.signal}),/Cancelled by reviewer/);
});

test('projects keep preferences and report access separate; imported data is previewed and backed up',async()=>{
 const root=await mkdtemp(join(tmpdir(),'atlas-projects-'));
 try{
  const store=await new ReviewStore(join(root,'state')).open();
  await store.setPreference('atlas-profiles',[profile]);
  const run=newRun('https://example.com',devices,profile);run.status='completed';await store.register(run,join(root,'report'));
  const bundle=exportProject(store);
  await store.createProject('Second project',true);
  assert.equal(store.history().length,0);assert.throws(()=>store.get(run.id),/not found/);
  const plan=await prepareImport({...bundle,preferences:{'atlas-profiles':[{...profile,name:'Imported profile'}]}},join(root,'package.json'),store);
  assert.equal(plan.counts.profiles,1);assert.equal(store.preferences['atlas-profiles'].length,1);
  await applyImport(plan,store);assert.equal(store.preferences['atlas-profiles'].length,2);
  assert((await readdir(store.directory)).some(file=>file.startsWith('before-import-')));
  assert.equal(JSON.parse(await readFile(join(root,'report','run.json'))).id,run.id);
  const restored=await new ReviewStore(store.directory).open();assert.equal(restored.project.name,'Second project');assert.equal(restored.project.temporary,true);
  await restored.selectProject('default');assert.equal(restored.history().length,1);assert.equal(restored.preferences['atlas-profiles'].length,1);
  await assert.rejects(prepareImport({format:'viewport-atlas-workspace',version:1,preferences:{'atlas-devices':[{...devices[0],width:9000}]}},'',restored),/widths/);
  restored.project.mappings=Array.from({length:200},(_,index)=>({source:`source-${index}`,viewId:'phone',selector:'#target'}));
  await assert.rejects(prepareImport({format:'viewport-atlas-workspace',version:1,mappings:[{source:'new-source',viewId:'phone',selector:'#target'}]},'',restored),/200 counterpart/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('interrupted recording and replay retain plans and completed reports without automatic execution',()=>{
 const plan={id:'plan',name:'Journey',startUrl:'https://example.com',steps:[{id:'screen',type:'checkpoint',label:'Screen',url:'https://example.com',audit:true}]};
 const state=interruptedFlows({plans:[plan],selectedId:'plan',recording:{planId:'plan'},job:{status:'running',screens:[{runId:'saved-evidence',status:'completed'}]}});
 assert.equal(state.recording,null);assert(state.plans[0].interruption);assert.equal(state.job.status,'failed');assert.equal(state.job.screens[0].runId,'saved-evidence');
 assert(state.plans[0].steps.some(step=>step.type==='blocked'),'A crash must retain a gap that requires review before replay');
 assert.throws(()=>interruptedFlows({plans:[{...plan,steps:[{id:'bad',type:'navigate',label:'Unsafe',url:'https://example.com/?token=secret'}]}]}),/secret query/);
});

test('GitHub updates defer checks and installation while review work is active',()=>{
 const updater=new EventEmitter();let feed,checks=0,installs=0,busy=true;
 updater.setFeedURL=value=>feed=value;updater.checkForUpdates=()=>{checks++;updater.emit('checking-for-update');};updater.quitAndInstall=()=>installs++;
 const updates=new DesktopUpdates({updater,version:'0.1.0',platform:'darwin',arch:'arm64',enabled:true,busy:()=>busy});
 try{
  assert.equal(feed.url,'https://update.electronjs.org/gil00pita/ViewportAtlas/darwin-arm64/0.1.0');
  updates.check();assert.equal(checks,0);assert.equal(updates.state.status,'deferred');busy=false;updates.check();assert.equal(checks,1);
  updater.emit('update-downloaded');busy=true;assert.throws(()=>updates.install(),/Finish or cancel/);assert.equal(installs,0);
  busy=false;updates.install();assert.equal(installs,1);
 }finally{updates.close();}
});
