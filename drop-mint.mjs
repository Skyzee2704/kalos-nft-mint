// immediate mint for an OPEN eligible allowlist stage or public stage. usage: node drop-mint.mjs <slug> allow [stageName] | public  (LIVE=1 to send)
// exit: 0 ok,2 not open,3 pending nonce,5 min bal,6 not elig,7 ended,8 done,9 excluded,10 unknown mode,11 STAGE FULL,12 SOLD OUT  -> 6-12 = permanent, don't retry
import {pub,acct} from './lpkit.mjs';
import {createWalletClient,http,formatEther} from 'viem';
import {prepare,check,holdMint,EXIT,RPC} from './mint-core.mjs';
const chain={id:99801,name:'Elysium',nativeCurrency:{name:'HYPE',symbol:'HYPE',decimals:18},rpcUrls:{default:{http:[RPC]}}};
const w=createWalletClient({account:acct,chain,transport:http(RPC)});
const [slug,mode,stageName]=process.argv.slice(2);
if(mode!=='allow'&&mode!=='public'){console.log('unknown mode');process.exit(EXIT.PUBLIC)}
if(slug==='daimons'){console.log('daimons excluded');process.exit(EXIT.EXCLUDED)}
const P=await prepare(slug,mode==='public'?'public':stageName);if(P.code){console.log(P.msg);process.exit(P.code)}
const blk=await pub.getBlock();const now=Number(blk.timestamp);
if(now<P.start){console.log('not open yet (chain ts)');process.exit(EXIT.NOT_OPEN)}if(now>P.end){console.log('ended');process.exit(EXIT.ENDED)}
const C=await check(P);console.log(P.stage,C.msg);if(C.code)process.exit(C.code);
const b0=await pub.getBalance({address:acct.address});
const lat=await pub.getTransactionCount({address:acct.address}),pen=await pub.getTransactionCount({address:acct.address,blockTag:'pending'});
if(lat!==pen){console.log('pending tx');process.exit(EXIT.PENDING)}
await pub.call({account:acct.address,to:P.SD,data:C.data,value:C.value});console.log('sim ok qty',String(C.Q));
const gas=(await pub.estimateGas({account:acct.address,to:P.SD,data:C.data,value:C.value}))*14n/10n;
const gp=(await pub.getGasPrice())*15n/10n;
if(b0-C.value-gas*gp<10n**18n){console.log('min bal');process.exit(EXIT.MINBAL)}
if(process.env.LIVE!=='1'){console.log('dry ok',formatEther(C.value));process.exit(0)}
holdMint(P.NFT);
const h=await w.sendTransaction({to:P.SD,data:C.data,value:C.value,gas,gasPrice:gp,nonce:lat});console.log('tx',h);
const r=await pub.waitForTransactionReceipt({hash:h,timeout:180000});const b1=await pub.getBalance({address:acct.address});
console.log('RESULT',JSON.stringify({slug,stage:P.stage,qty:String(C.Q),status:r.status,tx:h,cost:formatEther(b0-b1),at:new Date().toLocaleString('sv',{timeZone:'Asia/Makassar'})}));
process.exit(r.status==='success'?0:1);
