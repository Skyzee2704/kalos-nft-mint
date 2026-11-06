const A = process.env.KALOS_WALLET_ADDRESS || '0xE9973af1b69E407745926fA985C0090E0e78DcF1';
async function J(u){for(let i=0;i<5;i++){try{const r=await fetch(u,{headers:{'user-agent':'curl/8'}});return JSON.parse(await r.text())}catch{await new Promise(r=>setTimeout(r,3000))}}return null}
const d=(await J('https://api.kalos.fun/v2/launch/drops')).drops;const now=Date.now()/1e3;const out=[];
for(const x of d){const e=await J(`https://api.kalos.fun/v2/launch/drops/${x.slug}/eligibility/${A}`);
 const en=(e?.entries||[]).map(s=>({stage:s.stageName,price:s.price,max:s.mintParams.maxTotalMintableByWallet,start:+s.mintParams.startTime,end:+s.mintParams.endTime}));
 out.push({slug:x.slug,name:x.name,status:x.status,pubStart:x.public?.start,pubEnd:x.public?.end,minted:x.minted??x.totalMinted,supply:x.maxSupply??x.supply,elig:en});}
console.log(JSON.stringify(out));
// auto-schedule eligible allowlist stages + public stages (user order 4 Nov 23:40: public juga mint; user rule 23:52: kalo masih bisa ya mint). AUTOSCHED=0 to disable.
if(process.env.AUTOSCHED!=='0'&&process.env.KALOS_PRIVATE_KEY){const fs=(await import('fs')).default;const {execSync,spawn}=await import('child_process');
 const log=s=>fs.appendFileSync('drop-scan.log',`[${new Date().toLocaleString('sv',{timeZone:'Asia/Makassar'})} WITA] AUTO ${s}\n`);
 const running=k=>{try{return execSync('ps -eo args').toString().split('\n').some(l=>l.startsWith('node ')&&l.includes(k))}catch{return false}};
 let seen={};try{seen=JSON.parse(fs.readFileSync('drop-scan-seen.json'))}catch{};for(const x of out){if(x.slug==='daimons')continue;const sched=[...x.elig];if(x.pubStart&&x.pubEnd&&!x.elig.some(e=>e.stage==='public'))sched.push({stage:'public',start:x.pubStart,end:x.pubEnd,isPublic:true});seen[x.slug]=1;for(const s of sched){const key=`${x.slug} ${s.stage}`;const skey=`mint-sched.mjs ${key}`;
  if(now>=s.end)continue;
  if(s.start>now){if(running(skey))continue;const p=spawn('setsid',['node','mint-sched.mjs',x.slug,s.stage],{env:{...process.env,LIVE:'1'},detached:true,stdio:['ignore',fs.openSync('drop-sched.log','a'),fs.openSync('drop-sched.log','a')]});p.unref();log(`scheduler dipasang ${key} pid ${p.pid} buka ${new Date(s.start*1e3).toLocaleString('sv',{timeZone:'Asia/Makassar'})}`);}
  else{if(running(skey)||running(`drop-mint.mjs ${x.slug}`))continue;let c=0;const cmd=s.isPublic?`drop-mint.mjs ${x.slug} public`:`drop-mint.mjs ${x.slug} allow "${s.stage}"`;try{execSync(`LIVE=1 timeout 200 node ${cmd} >> drop-sched.log 2>&1`)}catch(e){c=e.status}
   if(c!==8&&c!==6)log(`mint langsung ${key} exit ${c}${c===0?' (OK)':c===11?' STAGE FULL':c===12?' SOLD OUT':''}`);}}}try{fs.writeFileSync('drop-scan-seen.json',JSON.stringify(seen))}catch{};}
