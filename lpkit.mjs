// Concentrated LP kit (USDC/WHYPE etc). Key only via process.env inside viem account. LIVE=1 to send.
import { createPublicClient, createWalletClient, http, parseEther, formatEther, parseAbi, encodeFunctionData, maxUint256, parseEventLogs } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
const RPC=process.env.KALOS_RPC||'https://testnet-rpc.elysium.kinetiq.xyz';
const chain={id:99801,name:'Elysium',nativeCurrency:{name:'HYPE',symbol:'HYPE',decimals:18},rpcUrls:{default:{http:[RPC]}}};
export const pub=createPublicClient({chain,transport:http(RPC,{timeout:60000,retryCount:4})});
const pk=process.env.KALOS_PRIVATE_KEY; export const acct=privateKeyToAccount(pk.startsWith('0x')?pk:'0x'+pk);
const w=createWalletClient({account:acct,chain,transport:http(RPC)});
export const LIVE=process.env.LIVE==='1'; export const MIN_BAL=parseEther(process.env.MIN_BAL||'1.0');
export const ROUTER='0x752f6816Bc514e1Eeff852b2eAdcd96f6c0F9f3f',QUOTER='0x2b555398ac8BAf5d4B541EF12E565eF312739149',NPM='0x28580f9baeDDBc88D3Daca542aF12271E52B5765',WH='0xCD57F65c2B0e5881CFC2E609F7CD53b746E1F234';
export const erc=parseAbi(['function balanceOf(address) view returns (uint256)','function allowance(address,address) view returns (uint256)','function approve(address,uint256) returns (bool)']);
export const poolAbi=parseAbi(['function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)','function liquidity() view returns (uint128)','function tickSpacing() view returns (int24)','function token0() view returns (address)','function token1() view returns (address)','function fee() view returns (uint24)']);
export const npm=parseAbi(['function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline)) payable returns (uint256,uint128,uint256,uint256)','function refundETH() payable','function multicall(bytes[]) payable returns (bytes[])','function positions(uint256) view returns (uint96,address,address,address,uint24,int24,int24,uint128,uint256,uint256,uint128,uint128)','function decreaseLiquidity((uint256 tokenId,uint128 liquidity,uint256 amount0Min,uint256 amount1Min,uint256 deadline)) payable returns (uint256,uint256)','function collect((uint256 tokenId,address recipient,uint128 amount0Max,uint128 amount1Max)) payable returns (uint256,uint256)','function unwrapWETH9(uint256,address) payable','function sweepToken(address,uint256,address) payable','event IncreaseLiquidity(uint256 indexed tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)']);
export const router=parseAbi(['function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256)']);
const qa=parseAbi(['function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256,uint160,uint32,uint256)']);
export const bal=()=>pub.getBalance({address:acct.address});
export const dl=()=>BigInt(Math.floor(Date.now()/1000)+600);
export const quote=async(a,b,amt,fee)=>(await pub.simulateContract({address:QUOTER,abi:qa,functionName:'quoteExactInputSingle',args:[{tokenIn:a,tokenOut:b,amountIn:amt,fee,sqrtPriceLimitX96:0n}]})).result[0];
export async function send(req,log=console.log){
  const v=req.value||0n; if((await bal())-v<MIN_BAL) throw Error('balance would drop below MIN_BAL, stop');
  const {request}=await pub.simulateContract({account:acct,...req});
  if(!LIVE){log('SIM OK',req.functionName);return null}
  let g;try{g=await pub.estimateContractGas({account:acct,...req})}catch(e){g=800000n} const hash=await w.writeContract({...request,gas:g*14n/10n}); const r=await pub.waitForTransactionReceipt({hash,timeout:180000});
  log(new Date().toISOString(),req.functionName,hash,r.status,'gasfee',formatEther(r.gasUsed*r.effectiveGasPrice));
  if(r.status!=='success') throw Error('revert '+hash); return r;
}
export async function poolInfo(P){const [s,ts,t0,t1,fee]=await Promise.all(['slot0','tickSpacing','token0','token1','fee'].map(f=>pub.readContract({address:P,abi:poolAbi,functionName:f})));return {P,sqrt:s[0],tick:Number(s[1]),ts:Number(ts),t0,t1,fee:Number(fee)}}
const L1=Math.log(1.0001);
// open position of total value V (wei HYPE) in range +-R around current price. Pool must contain WHYPE.
export async function openPosition(P,V,R,log=console.log,asym=null){
  const pi=await poolInfo(P); const whIs1=pi.t1.toLowerCase()===WH.toLowerCase(); const tok=whIs1?pi.t0:pi.t1;
  const d=Math.round(Math.log(1+R)/L1); const dl_=asym?Math.round(Math.log(1+asym.lo)/L1):d, dh_=asym?Math.round(Math.log(1+asym.hi)/L1):d; let lo=Math.floor((pi.tick-dl_)/pi.ts)*pi.ts, hi=Math.ceil((pi.tick+dh_)/pi.ts)*pi.ts;
  const sp=Number(pi.sqrt)/2**96, spa=Math.sqrt(1.0001**lo), spb=Math.sqrt(1.0001**hi);
  const a0=(1/sp-1/spb), a1=(sp-spa); // per unit L, raw
  const v0in1=a0*sp*sp; // value of token0 in token1 raw
  const fracWH = whIs1? a1/(a1+v0in1) : v0in1/(a1+v0in1);
  const swapAmt=BigInt(Math.floor(Number(V)*(1-fracWH)*1.01)); // +1% for 2% fee etc (slightly over: excess WHYPE refunded? no -> excess token stays)
  log('open',P,'tick',pi.tick,'range',lo,hi,'V',formatEther(V),'swap',formatEther(swapAmt));
  const q=await quote(WH,tok,swapAmt,pi.fee); const back=await quote(tok,WH,q,pi.fee);
  log('quote out',q.toString(),'roundtrip',formatEther(back),'of',formatEther(swapAmt));
  const tb0=await pub.readContract({address:tok,abi:erc,functionName:'balanceOf',args:[acct.address]});
  await send({address:ROUTER,abi:router,functionName:'exactInputSingle',value:swapAmt,args:[{tokenIn:WH,tokenOut:tok,fee:pi.fee,recipient:acct.address,deadline:dl(),amountIn:swapAmt,amountOutMinimum:q*99n/100n,sqrtPriceLimitX96:0n}]},log);
  const tb=LIVE?await pub.readContract({address:tok,abi:erc,functionName:'balanceOf',args:[acct.address]}):q;
  if(LIVE&&await pub.readContract({address:tok,abi:erc,functionName:'allowance',args:[acct.address,NPM]})<tb) await send({address:tok,abi:erc,functionName:'approve',args:[NPM,maxUint256]},log);
  const whAmt=V-swapAmt; const p={token0:pi.t0,token1:pi.t1,fee:pi.fee,tickLower:lo,tickUpper:hi,amount0Desired:whIs1?tb:whAmt,amount1Desired:whIs1?whAmt:tb,amount0Min:0n,amount1Min:0n,recipient:acct.address,deadline:dl()};
  if(!LIVE){log('SIM: mint skipped (needs token)');return null}
  const m=encodeFunctionData({abi:npm,functionName:'mint',args:[p]});
  const r=await send({address:NPM,abi:npm,functionName:'multicall',value:whAmt,args:[[m,encodeFunctionData({abi:npm,functionName:'refundETH'})]]},log);
  const ev=parseEventLogs({abi:npm,logs:r.logs,eventName:'IncreaseLiquidity'})[0].args; log('POSITION tokenId',ev.tokenId.toString(),'L',ev.liquidity.toString(),'amt0',ev.amount0.toString(),'amt1',ev.amount1.toString(),'ticks',lo,hi);
  return {tokenId:ev.tokenId,lo,hi};
}
export async function closePosition(id,tok,log=console.log){
  const pos=await pub.readContract({address:NPM,abi:npm,functionName:'positions',args:[id]});const M=2n**128n-1n;
  const calls=[]; if(pos[7]>0n) calls.push(encodeFunctionData({abi:npm,functionName:'decreaseLiquidity',args:[{tokenId:id,liquidity:pos[7],amount0Min:0n,amount1Min:0n,deadline:dl()}]}));
  calls.push(encodeFunctionData({abi:npm,functionName:'collect',args:[{tokenId:id,recipient:'0x0000000000000000000000000000000000000000',amount0Max:M,amount1Max:M}]}),encodeFunctionData({abi:npm,functionName:'unwrapWETH9',args:[0n,acct.address]}),encodeFunctionData({abi:npm,functionName:'sweepToken',args:[tok,0n,acct.address]}));
  const pb=await pub.getBalance({address:acct.address}); const {request}=await pub.simulateContract({account:acct,address:NPM,abi:npm,functionName:'multicall',args:[calls]});
  if(!LIVE){log('SIM OK close',id);return}
  const g=await pub.estimateContractGas({account:acct,address:NPM,abi:npm,functionName:"multicall",args:[calls]});const hash=await w.writeContract({...request,gas:g*14n/10n});const r=await pub.waitForTransactionReceipt({hash,timeout:180000});log(new Date().toISOString(),"close",id.toString(),hash,r.status);if(r.status!=='success')throw Error('revert');
}
