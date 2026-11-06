// t135u: on-time stage sniper. usage: node mint-sched.mjs <slug> <stageName> [--fake-start=<unix>] (LIVE=1 to send; otherwise dry: signs but never broadcasts)
// Flow: sleep until T-5s -> prepare (proof/calldata/value/gas/gasPrice x2/nonce) & SIGN -> poll blocks every 100ms (user order 5 Nov 04:12 WITA: sign 5s before open for on-time mint)
//  -> on first block with timestamp>=start: re-check nonce (re-sign locally if changed, ~ms), broadcast raw tx 2x (2 RPC calls). No swap-window wait.
import {pub,acct} from './lpkit.mjs';
import {createWalletClient,http,formatEther} from 'viem';
import {prepare,check,holdMint,EXIT,RPC} from './mint-core.mjs';
import fs from 'fs';
const chain={id:99801,name:'Elysium',nativeCurrency:{name:'HYPE',symbol:'HYPE',decimals:18},rpcUrls:{default:{http:[RPC]}}};
const w=createWalletClient({account:acct,chain,transport:http(RPC)});
const [slug,stageName]=process.argv.slice(2);const fake=(process.argv.find(a=>a.startsWith('--fake-start='))||'').split('=')[1];
const LIVE=process.env.LIVE==='1'&&!fake;
const L=(...a)=>{const s=`[${new Date().toLocaleString('sv',{timeZone:'Asia/Makassar'})}.${String(Date.now()%1000).padStart(3,'0')} WITA] ${slug}/${stageName} `+a.join(' ');console.log(s);try{fs.appendFileSync('drop-sched.log',s+'\n')}catch{}};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
if(slug==='daimons'){L('excluded');process.exit(EXIT.EXCLUDED)}
let P=await prepare(slug,stageName);if(P.code){L(P.msg);process.exit(P.code)}
const start=fake?+fake:P.start;L('stage start',new Date(start*1e3).toLocaleString('sv',{timeZone:'Asia/Makassar'}),LIVE?'LIVE':'DRY');
// offset local clock vs chain
const chainNow=async()=>Number((await pub.getBlock()).timestamp);
while(true){const dt=start-await chainNow();if(dt<=5)break;await sleep(Math.min((dt-5)*1000,300000));}
P=await prepare(slug,stageName);if(P.code){L(P.msg);process.exit(P.code)}
let C=await check(P);L("pre-check",C.msg);if(C.code&&fake&&process.env.TESTQ){C={...C,code:0,Q:1n};const {encodeFunctionData}=await import("viem");const {abi}=await import("./mint-core.mjs");if(P.isPublic){C.data=encodeFunctionData({abi,functionName:"mintPublic",args:[P.NFT,P.FR,acct.address,1n]});C.value=P.mintPrice}else{C.data=encodeFunctionData({abi,functionName:"mintAllowList",args:[P.NFT,P.FR,acct.address,1n,P.mp,P.proof]});C.value=P.mp.mintPrice;}L("TEST: ignoring stop for latency test")}if(C.code){L('STOP permanent');process.exit(C.code)}
const gas=350000n;let gp=(await pub.getGasPrice())*2n;
const b=await pub.getBalance({address:acct.address});if(b-C.value-gas*gp<10n**18n){L('min bal: free native would drop <1 HYPE');process.exit(EXIT.MINBAL)}
let nonce=await pub.getTransactionCount({address:acct.address,blockTag:'pending'});
const sign=async()=>w.signTransaction(await w.prepareTransactionRequest({to:P.SD,data:C.data,value:C.value,gas,gasPrice:gp,nonce,type:'legacy',chain}));
let raw=await sign();L('signed nonce',nonce,'gasPrice',gp,'value',formatEther(C.value),'qty',String(C.Q));
let lastSupply=Date.now();
while(true){const blk=await pub.getBlock();const ts=Number(blk.timestamp);
 if(ts>=start){const t0=Date.now();
  
  if(!LIVE){L(`DRY fire: block ${blk.number} ts ${ts} >= start ${start}; detect->ready ${Date.now()-t0}ms (would broadcast now)`);
   try{await pub.call({account:acct.address,to:P.SD,data:C.data,value:C.value});L('eth_call sim OK')}catch(e){L('eth_call sim revert',(e.shortMessage||e.message).slice(0,160))}process.exit(0)}
  holdMint(P.NFT);let h;
  for(let i=0;i<2;i++){try{h=await pub.request({method:'eth_sendRawTransaction',params:[raw]})}catch(e){if(!/known|already/i.test(e.message))L('send err',e.message.slice(0,120))}}
  L('SENT',h,'block',blk.number,'detect->sent',Date.now()-t0,'ms');
  const r=await pub.waitForTransactionReceipt({hash:h,timeout:120000});
  L('RESULT',JSON.stringify({status:r.status,block:String(r.blockNumber),blocksAfterOpen:String(r.blockNumber-blk.number),tx:h}));process.exit(r.status==='success'?0:1)}
 if(!(fake&&process.env.TESTQ)&&Date.now()-lastSupply>5000){lastSupply=Date.now();const c2=await check(P);if(c2.code){L('pre-open check:',c2.msg,'STOP');process.exit(c2.code)}}
 const pn=await pub.getTransactionCount({address:acct.address,blockTag:'pending'});if(pn!==nonce){nonce=pn;raw=await sign();L('nonce changed -> re-signed',nonce)}
 await sleep(start-ts>30?1000:100);}
