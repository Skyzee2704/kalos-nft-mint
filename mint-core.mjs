// shared mint prep (allowlist + public stages). Never logs key.
import {pub,acct} from './lpkit.mjs';
import {parseAbi,encodeFunctionData} from 'viem';
import fs from 'fs';
export const RPC=process.env.KALOS_RPC||'https://testnet-rpc.elysium.kinetiq.xyz';
export const abi=parseAbi(['function mintAllowList(address,address,address,uint256,(uint256 mintPrice,uint256 maxTotalMintableByWallet,uint256 startTime,uint256 endTime,uint256 dropStageIndex,uint256 maxTokenSupplyForStage,uint256 feeBps,bool restrictFeeRecipients),bytes32[]) payable','function mintPublic(address,address,address,uint256) payable','function getMintStats(address) view returns (uint256,uint256,uint256)']);
export const EXIT={OK:0,NOT_OPEN:2,PENDING:3,MINBAL:5,NOT_ELIG:6,ENDED:7,DONE:8,EXCLUDED:9,PUBLIC:10,STAGE_FULL:11,SOLD_OUT:12};
export async function J(u,n=6){for(let i=0;i<n;i++){try{const r=await fetch(u,{headers:{'user-agent':'curl/8'}});return JSON.parse(await r.text())}catch{await new Promise(r=>setTimeout(r,1000))}}throw new Error('api '+u)}
// returns prepared mint for given slug & (optional) stage name; eligible allowlist entries, or 'public' for the drop's public stage
export async function prepare(slug,stageName){
 const D=(await J('https://api.kalos.fun/v2/launch/drops')).drops.find(x=>x.slug===slug);if(!D)return{code:EXIT.NOT_ELIG,msg:'drop not found'};
 if(stageName==='public'){const pb=D.public;if(!pb)return{code:EXIT.NOT_ELIG,msg:'no public stage'};return {D,SD:D.seaDrop,NFT:D.address,FR:D.feeRecipient,stage:'public',isPublic:true,mintPrice:BigInt(pb.priceWei),maxPerWallet:BigInt(pb.maxPerWallet),start:+pb.start,end:+pb.end};}
 const el=(await J(`https://api.kalos.fun/v2/launch/drops/${slug}/eligibility/${acct.address}`)).entries||[];
 const e=stageName?el.find(x=>x.stageName===stageName):el[0];if(!e)return{code:EXIT.NOT_ELIG,msg:'not eligible'};
 const m=e.mintParams;const mp={mintPrice:BigInt(m.mintPrice),maxTotalMintableByWallet:BigInt(m.maxTotalMintableByWallet),startTime:BigInt(m.startTime),endTime:BigInt(m.endTime),dropStageIndex:BigInt(m.dropStageIndex),maxTokenSupplyForStage:BigInt(m.maxTokenSupplyForStage),feeBps:BigInt(m.feeBps),restrictFeeRecipients:m.restrictFeeRecipients};
 return {D,SD:D.seaDrop,NFT:D.address,FR:D.feeRecipient,stage:e.stageName,mp,proof:e.proof,start:+m.startTime,end:+m.endTime};
}
// supply/limit check; returns {code,msg,Q,data,value}
export async function check(P){
 const [minted,total,maxSup]=await pub.readContract({address:P.NFT,abi,functionName:'getMintStats',args:[acct.address]});
 if(P.isPublic){const want=P.maxPerWallet-minted;const info=`minted=${minted}/${P.maxPerWallet} supply=${total}/${maxSup} public`;if(want<=0n)return{code:EXIT.DONE,msg:'done already '+info};if(total>=maxSup)return{code:EXIT.SOLD_OUT,msg:'SOLD OUT '+info};let Q=want;if(maxSup-total<Q)Q=maxSup-total;if(process.env.FORCEQ)Q=BigInt(process.env.FORCEQ);const data=encodeFunctionData({abi,functionName:'mintPublic',args:[P.NFT,P.FR,acct.address,Q]});return{code:EXIT.OK,msg:info,Q,data,value:P.mintPrice*Q};}
 const want=P.mp.maxTotalMintableByWallet-minted;const info=`minted=${minted}/${P.mp.maxTotalMintableByWallet} supply=${total}/${maxSup} stageCap=${P.mp.maxTokenSupplyForStage}`;
 if(want<=0n)return{code:EXIT.DONE,msg:'done already '+info};
 if(total>=maxSup)return{code:EXIT.SOLD_OUT,msg:'SOLD OUT '+info};
 const room=P.mp.maxTokenSupplyForStage-total;if(room<=0n)return{code:EXIT.STAGE_FULL,msg:'STAGE FULL '+info};
 let Q=want<room?want:room;if(maxSup-total<Q)Q=maxSup-total;if(process.env.FORCEQ)Q=BigInt(process.env.FORCEQ);
 const data=encodeFunctionData({abi,functionName:'mintAllowList',args:[P.NFT,P.FR,acct.address,Q,P.mp,P.proof]});
 return{code:EXIT.OK,msg:info,Q,data,value:P.mp.mintPrice*Q};
}
export function holdMint(nft){try{const f='hold-mint.json';const a=fs.existsSync(f)?JSON.parse(fs.readFileSync(f)):[];const n=String(nft).toLowerCase();if(!a.includes(n)){a.push(n);fs.writeFileSync(f,JSON.stringify(a))}}catch{}}
