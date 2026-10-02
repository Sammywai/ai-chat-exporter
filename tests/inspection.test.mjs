import assert from 'node:assert/strict';
import test from 'node:test';
import {inspectTab} from '../dist/core/export-session.js';

const empty={status:'empty',message:'No visible ChatGPT messages found. Open a conversation and wait for it to load.'};
const captured={status:'captured',boundariesReached:false,conversation:{provider:'chatgpt',title:'Synthetic chat',messages:[{id:'1',role:'user',blocks:[{type:'paragraph',text:'Synthetic prompt'}]}]}};

test('inspection recovers from an empty hydration frame without manual Rescan',async()=>{
  const original=globalThis.chrome;let calls=0;
  globalThis.chrome={
    tabs:{get:async()=>({id:7,url:'https://chatgpt.com/c/synthetic'})},
    scripting:{executeScript:async()=>[{result:++calls===1?empty:captured}]}
  };
  try {
    const result=await inspectTab(7);
    assert.equal(result.status,'captured',result.message);
    assert.equal(calls,2);
  }finally{globalThis.chrome=original}
});

test('inspection stops if source conversation changes while waiting for hydration',async()=>{
  const original=globalThis.chrome;let lookups=0;let injections=0;
  globalThis.chrome={
    tabs:{get:async()=>({id:7,url:`https://chatgpt.com/c/${++lookups===1?'first':'second'}`})},
    scripting:{executeScript:async()=>{injections++;return [{result:empty}]}}
  };
  try {
    const result=await inspectTab(7);
    assert.equal(result.status,'failed');
    assert.match(result.message,/changed/i);
    assert.equal(injections,1);
  }finally{globalThis.chrome=original}
});

test('inspection rejects a replacement chat captured during a retry injection',async()=>{
  const original=globalThis.chrome;let injections=0;let currentUrl='https://chatgpt.com/c/first';
  globalThis.chrome={
    tabs:{get:async()=>({id:7,url:currentUrl})},
    scripting:{executeScript:async()=>{
      if(++injections===1)return [{result:empty}];
      currentUrl='https://chatgpt.com/c/second';
      return [{result:captured}];
    }}
  };
  try {
    const result=await inspectTab(7);
    assert.equal(result.status,'failed');
    assert.match(result.message,/changed/i);
    assert.equal(injections,2);
  }finally{globalThis.chrome=original}
});
