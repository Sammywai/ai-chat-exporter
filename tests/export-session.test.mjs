import assert from 'node:assert/strict';
import test from 'node:test';
import { ExportSession, saveDownload, providerFromUrl, downloadFilename } from '../dist/core/export-session.js';

function harness({captureStatus='captured', downloadState='complete', downloadReject=false, deferCapture=false}={}) {
  const messages=new Set(), downloads=new Set();
  const calls={scans:0,downloads:0,cancels:0,acks:0};
  let release;
  const conversation={provider:'gemini',title:'長聊天',messages:[{id:'first',role:'user',blocks:[{type:'paragraph',text:'First question'}]},{id:'last',role:'assistant',blocks:[{type:'paragraph',text:'Final answer'}]}]};
  const chrome={
    runtime:{onMessage:{addListener:fn=>messages.add(fn),removeListener:fn=>messages.delete(fn)}},
    tabs:{get:async()=>({id:7,url:'https://gemini.google.com/app/test'})},
    scripting:{executeScript:async request=>{
      if(request.func.name==='cancelCapture') {calls.cancels++;release?.();return [{result:undefined}];}
      calls.scans++;
      if(deferCapture) await new Promise(resolve=>{release=resolve});
      const jobId=request.args[1].jobId;
      for(const listener of messages) listener({type:'capture-progress',jobId,phase:'Scanning messages',messageCount:2},{tab:{id:99}},()=>{throw new Error('Wrong tab acknowledged')});
      for(const listener of messages) listener({type:'capture-progress',jobId,phase:'Scanning messages',messageCount:2},{tab:{id:7}},response=>{assert.deepEqual(response,{alive:true});calls.acks++});
      return [{result:captureStatus==='captured'?{status:'captured',boundariesReached:true,conversation}:{status:captureStatus,message:'Scan incomplete; no file saved.'}}];
    }},
    downloads:{
      onChanged:{addListener:fn=>downloads.add(fn),removeListener:fn=>downloads.delete(fn)},
      download:async options=>{
        calls.downloads++;
        assert.ok(options.url.startsWith('blob:'));
        assert.equal(options.saveAs,true);
        if(downloadReject) throw new Error('User cancelled save dialog');
        for(const listener of downloads) listener({id:17,state:{current:downloadState}});
        return 17;
      },
      search:async()=>[{id:17,state:downloadState}]
    }
  };
  return {chrome,calls,messages,downloads,release:()=>release?.()};
}
async function usingHarness(options,fn) {
  const previous=globalThis.chrome;
  const h=harness(options); globalThis.chrome=h.chrome;
  try{await fn(h)}finally{globalThis.chrome=previous}
}

test('workspace captures Gemini, saves a Blob, confirms completion, then reuses captured chat',async()=>{
  await usingHarness({},async h=>{
    const progress=[];const session=new ExportSession(7,(...event)=>progress.push(event));
    assert.deepEqual(await session.export('markdown'),{filename:'長聊天.md',count:2});
    await session.export('markdown');
    assert.equal(h.calls.scans,1);
    assert.equal(h.calls.acks,1,'capture owner lease acknowledged only matching job and source');
    assert.equal(h.calls.downloads,2);
    assert.equal(progress.filter(p=>p[0]==='Scanning messages').length,1,'only source-tab progress accepted');
    assert.equal(h.messages.size,0);assert.equal(h.downloads.size,0);
    session.clear();await session.export('markdown');assert.equal(h.calls.scans,2);
  });
});

test('incomplete scan never reaches download',async()=>{
  await usingHarness({captureStatus:'failed'},async h=>{
    const session=new ExportSession(7,()=>{});
    await assert.rejects(session.export('markdown'),/Scan incomplete/);
    assert.equal(session.captured,null);assert.equal(h.calls.downloads,0);assert.equal(h.messages.size,0);
  });
});

test('interrupted download is failure and capture stays available for recovery',async()=>{
  await usingHarness({downloadState:'interrupted'},async h=>{
    const session=new ExportSession(7,()=>{});
    await assert.rejects(session.export('markdown'),/Download cancelled or interrupted/);
    assert.equal(session.captured.messages.length,2);
    assert.equal(h.downloads.size,0);assert.equal(h.messages.size,0);
  });
});

test('cancelled save dialog retains capture and releases listeners',async()=>{
  await usingHarness({downloadReject:true},async h=>{
    const session=new ExportSession(7,()=>{});
    await assert.rejects(session.export('markdown'),/User cancelled save dialog/);
    assert.equal(session.captured.messages.length,2);
    assert.equal(h.downloads.size,0);assert.equal(h.messages.size,0);
  });
});

test('cancellation during capture prevents download and concurrent start is rejected',async()=>{
  await usingHarness({deferCapture:true},async h=>{
    const session=new ExportSession(7,()=>{});
    const first=session.export('markdown');
    await new Promise(resolve=>setImmediate(resolve));
    await assert.rejects(session.export('markdown'),/already running/);
    await session.cancel();
    await assert.rejects(first,/Export cancelled/);
    assert.equal(h.calls.downloads,0);assert.equal(h.calls.cancels,1);assert.equal(h.messages.size,0);
  });
});

test('oversized PDF can recover as Markdown without rescanning',async()=>{
  await usingHarness({},async h=>{
    const session=new ExportSession(7,()=>{});
    session.captured={provider:'chatgpt',title:'Large',messages:[{id:'1',role:'assistant',blocks:[{type:'paragraph',text:'x'.repeat(1_000_001)}]}]};
    await assert.rejects(session.export('pdf'),/Choose Markdown/);
    await session.export('markdown');assert.equal(h.calls.scans,0);assert.equal(h.calls.downloads,1);
  });
});

test('download completion discovered by search after event was missed',async()=>{
  await usingHarness({},async h=>{
    h.chrome.downloads.download=async()=>17;
    await saveDownload(new Blob(['Hello']),'chat.md',()=>{});
    assert.equal(h.downloads.size,0);
  });
});

test('provider and filename guards retain supported hosts and reject lookalikes',()=>{
  for(const [url,provider] of [['https://chatgpt.com/c/1','chatgpt'],['https://gemini.google.com/app/1','gemini'],['https://claude.ai/chat/1','claude'],['https://x.com/i/grok/1','grok']]) assert.equal(providerFromUrl(url),provider);
  assert.equal(providerFromUrl('https://chatgpt.com.evil.test'),null);
  assert.equal(providerFromUrl('invalid url'),null);
  assert.equal(downloadFilename('../bad<> title.'),'.. bad title');
  assert.equal(downloadFilename('x'.repeat(200)).length,160);
});

test('cancel stops PDF worker without freezing workspace or starting download',async()=>{
  await usingHarness({},async h=>{
    const originalWorker=globalThis.Worker;
    let worker;
    globalThis.Worker=class {
      constructor(){worker=this;this.terminated=false}
      postMessage(){}
      terminate(){this.terminated=true}
    };
    h.chrome.runtime.getURL=path=>`chrome-extension://test/${path}`;
    const session=new ExportSession(7,()=>{});
    session.captured={provider:'chatgpt',title:'Render',messages:[{id:'1',role:'assistant',blocks:[{type:'paragraph',text:'Hello'}]}]};
    try{
      const pending=session.export('pdf');
      await session.cancel();
      await assert.rejects(pending,/Export cancelled/);
      assert.equal(worker.terminated,true);assert.equal(h.calls.downloads,0);
      assert.equal(session.captured.messages.length,1);assert.equal(h.messages.size,0);
    }finally{globalThis.Worker=originalWorker}
  });
});

test('cancelling while source lookup is pending never starts a later scan',async()=>{
  await usingHarness({},async h=>{
    let finishLookup;
    h.chrome.tabs.get=()=>new Promise(resolve=>{finishLookup=resolve});
    const session=new ExportSession(7,()=>{});
    const pending=session.export('markdown');
    await session.cancel();
    finishLookup({id:7,url:'https://gemini.google.com/app/test'});
    await assert.rejects(pending,/Export cancelled/);
    assert.equal(h.calls.scans,0);
    assert.equal(h.calls.downloads,0);
    assert.equal(h.messages.size,0);
  });
});
