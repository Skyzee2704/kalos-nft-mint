// One-off: outlaws allowlist mint. Background: the API eligibility entry for
// outlaws carries STALE times (2026-11-02 22:00-23:30 WITA, ended) while the
// drop object lists the real stage window (2026-11-04 22:00 - 2026-11-05 23:30
// WITA). The standard pipeline (mint-core prepare) trusts the eligibility
// times, so it skips outlaws. This script builds mintParams from the DROP
// stage times + the live eligibility proof (root published, rootIsKalos).
// Usage: node outlaws-mint.mjs (LIVE=1 to send; otherwise dry run only).
// Exits: 0 ok, 6 not eligible, 8 done already, 12 sold out, 5 min balance.
// Never logs the key.
import {pub, acct} from './lpkit.mjs';
import {createWalletClient, http, formatEther, encodeFunctionData} from 'viem';
import {abi, holdMint, RPC, J} from './mint-core.mjs';
const chain={id:99801,name:'Elysium',nativeCurrency:{name:'HYPE',symbol:'HYPE',decimals:18},rpcUrls:{default:{http:[RPC]}}};
const w=createWalletClient({account:acct,chain,transport:http(RPC)});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const SLUG='outlaws';
const D=(await J('https://api.kalos.fun/v2/launch/drops')).drops.find(x=>x.slug===SLUG);
if(!D){console.log('drop not found');process.exit(6)}
const el=(await J(`https://api.kalos.fun/v2/launch/drops/${SLUG}/eligibility/${acct.address}`)).entries||[];
const e=el[0];
if(!e){console.log('not eligible');process.exit(6)}
const st=(D.stages||[]).find(s=>s.index===e.stageIndex)||D.stages[0];
const mp={mintPrice:BigInt(st.priceWei),maxTotalMintableByWallet:BigInt(e.mintParams.maxTotalMintableByWallet),startTime:BigInt(st.start),endTime:BigInt(st.end),dropStageIndex:BigInt(e.mintParams.dropStageIndex),maxTokenSupplyForStage:BigInt(e.mintParams.maxTokenSupplyForStage),feeBps:BigInt(e.mintParams.feeBps),restrictFeeRecipients:e.mintParams.restrictFeeRecipients};
console.log('stage',e.stageName,'window',new Date(Number(mp.startTime)*1e3).toLocaleString('sv',{timeZone:'Asia/Makassar'}),'->',new Date(Number(mp.endTime)*1e3).toLocaleString('sv',{timeZone:'Asia/Makassar'}),'price',formatEther(mp.mintPrice));
// Wait for chain start (cron may fire minutes early).
// NO_WAIT=1: for hourly-scan retries — exit immediately if not open yet,
// instead of blocking the scan worker until start.
if(process.env.NO_WAIT==='1'){const ts0=Number((await pub.getBlock()).timestamp);if(ts0<Number(mp.startTime)){console.log('not open yet');process.exit(2)}}
// PRESIGN=1 (user order 4 Nov 21:18 WITA: all mints presign, including
// outlaws). mint-sched pattern: sign at ~T-60s, poll blocks every 100ms near
// open, broadcast on the first block with ts >= start, re-sign if the nonce
// changed. Difference from mint-sched's live path: one fast sim at the open
// block before broadcasting, so an invalid proof does not burn gas. If the
// run starts at/after open, fall through to the immediate path below.
if(process.env.PRESIGN==='1'){
  const tsNow=Number((await pub.getBlock()).timestamp);
  if(tsNow<Number(mp.startTime)){
    const [minted0,total0,maxSup0]=await pub.readContract({address:D.address,abi,functionName:'getMintStats',args:[acct.address]});
    const want0=mp.maxTotalMintableByWallet-minted0;
    console.log(`presign check minted=${minted0}/${mp.maxTotalMintableByWallet} supply=${total0}/${maxSup0} stageCap=${mp.maxTokenSupplyForStage}`);
    if(want0<=0n){console.log('done already');process.exit(8)}
    if(total0>=maxSup0){console.log('SOLD OUT');process.exit(12)}
    const room0=mp.maxTokenSupplyForStage-total0;
    if(room0<=0n){console.log('STAGE FULL');process.exit(11)}
    let Q0=want0<room0?want0:room0;if(maxSup0-total0<Q0)Q0=maxSup0-total0;
    const data0=encodeFunctionData({abi,functionName:'mintAllowList',args:[D.address,D.feeRecipient,acct.address,Q0,mp,e.proof]});
    const value0=mp.mintPrice*Q0;
    const gas0=350000n;const gp0=(await pub.getGasPrice())*2n;
    const bPre=await pub.getBalance({address:acct.address});
    if(bPre-value0-gas0*gp0<10n**18n){console.log('min bal');process.exit(5)}
    let nonce0=await pub.getTransactionCount({address:acct.address,blockTag:'pending'});
    const sign0=async()=>w.signTransaction(await w.prepareTransactionRequest({to:D.seaDrop,data:data0,value:value0,gas:gas0,gasPrice:gp0,nonce:nonce0,type:'legacy',chain}));
    if(process.env.PRESIGN_SIGN_TEST==='1'){const rawT=await sign0();console.log('sign test ok, raw len',rawT.length,'nonce',nonce0,'qty',String(Q0));process.exit(0)}
    while(true){const dt=Number(mp.startTime)-Number((await pub.getBlock()).timestamp);if(dt<=60)break;await sleep(Math.min((dt-60)*1000,300000))}
    let raw0=await sign0();
    console.log('presign signed nonce',nonce0,'qty',String(Q0),'value',formatEther(value0));
    if(process.env.LIVE!=='1'){console.log('presign dry ok');process.exit(0)}
    const tStart=Date.now();
    while(true){
      const blk=await pub.getBlock();const ts=Number(blk.timestamp);
      if(ts>=Number(mp.startTime)){
        let simErr0=null;
        try{await pub.call({account:acct.address,to:D.seaDrop,data:data0,value:value0})}catch(err){simErr0=err}
        if(simErr0){console.log('presign open sim revert',(simErr0.shortMessage||simErr0.message||'').slice(0,300));process.exit(1)}
        const pn=await pub.getTransactionCount({address:acct.address,blockTag:'pending'});
        if(pn!==nonce0){nonce0=pn;raw0=await sign0();console.log('nonce changed -> re-signed',nonce0)}
        let h0=null;
        for(let i=0;i<2;i++){try{h0=await pub.request({method:'eth_sendRawTransaction',params:[raw0]});break}catch(err){if(!/known|already/i.test(err.message))console.log('send err',err.message.slice(0,120))}}
        if(!h0){console.log('broadcast failed');process.exit(1)}
        console.log('presign tx',h0);
        const r0=await pub.waitForTransactionReceipt({hash:h0,timeout:180000});
        if(r0.status==='success')holdMint(D.address);
        const b1=await pub.getBalance({address:acct.address});
        console.log('RESULT',JSON.stringify({slug:SLUG,stage:e.stageName,qty:String(Q0),status:r0.status,tx:h0,cost:formatEther(bPre-b1),presign:true,at:new Date().toLocaleString('sv',{timeZone:'Asia/Makassar'})}));
        process.exit(r0.status==='success'?0:1);
      }
      if(Date.now()-tStart>600000){console.log('presign open wait timeout, falling through to immediate path');break}
      await sleep(ts>Number(mp.startTime)-30?100:1000);
    }
  }
}
while(true){const ts=Number((await pub.getBlock()).timestamp);if(ts>=Number(mp.startTime))break;await sleep(Math.min((Number(mp.startTime)-ts)*1000,60000))}
const [minted,total,maxSup]=await pub.readContract({address:D.address,abi,functionName:'getMintStats',args:[acct.address]});
const want=mp.maxTotalMintableByWallet-minted;
console.log(`minted=${minted}/${mp.maxTotalMintableByWallet} supply=${total}/${maxSup} stageCap=${mp.maxTokenSupplyForStage}`);
if(want<=0n){console.log('done already');process.exit(8)}
if(total>=maxSup){console.log('SOLD OUT');process.exit(12)}
const room=mp.maxTokenSupplyForStage-total;
if(room<=0n){console.log('STAGE FULL');process.exit(11)}
let Q=want<room?want:room;if(maxSup-total<Q)Q=maxSup-total;
const data=encodeFunctionData({abi,functionName:'mintAllowList',args:[D.address,D.feeRecipient,acct.address,Q,mp,e.proof]});
const value=mp.mintPrice*Q;
// Simulate first; one retry after 30s on failure (timing edge), then fail.
let simErr=null;const simTries=process.env.FAST==='1'?1:2;
for(let i=0;i<simTries;i++){try{await pub.call({account:acct.address,to:D.seaDrop,data,value});simErr=null;break}catch(err){simErr=err;if(i===0&&process.env.FAST!=='1')await sleep(30000)}}
if(simErr){console.log('sim revert',(simErr.shortMessage||simErr.message||'').slice(0,300));process.exit(1)}
console.log('sim ok qty',String(Q));
const b0=await pub.getBalance({address:acct.address});
const gas=(await pub.estimateGas({account:acct.address,to:D.seaDrop,data,value}))*14n/10n;
const gp=(await pub.getGasPrice())*15n/10n;
if(b0-value-gas*gp<10n**18n){console.log('min bal');process.exit(5)}
if(process.env.LIVE!=='1'){console.log('dry ok',formatEther(value));process.exit(0)}
holdMint(D.address);
const lat=await pub.getTransactionCount({address:acct.address});
const h=await w.sendTransaction({to:D.seaDrop,data,value,gas,gasPrice:gp,nonce:lat});
console.log('tx',h);
const r=await pub.waitForTransactionReceipt({hash:h,timeout:180000});
const b1=await pub.getBalance({address:acct.address});
console.log('RESULT',JSON.stringify({slug:SLUG,stage:e.stageName,qty:String(Q),status:r.status,tx:h,cost:formatEther(b0-b1),at:new Date().toLocaleString('sv',{timeZone:'Asia/Makassar'})}));
process.exit(r.status==='success'?0:1);
