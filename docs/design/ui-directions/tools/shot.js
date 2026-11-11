const {chromium}=require('playwright');
(async()=>{
 const b=await chromium.launch();
 const files=process.argv.slice(2);
 for(const f of files){
  for(const [n,w,h] of [['desktop',1440,900],['mobile',390,844]]){
   const p=await b.newPage({viewport:{width:w,height:h},deviceScaleFactor:n==='mobile'?2:1});
   p.on('pageerror',e=>console.log('ERR',f,e.message));
   await p.goto('file://'+__dirname+'/'+f);await p.waitForTimeout(800);
   const base=f.replace('.html','');
   await p.screenshot({path:`shots/${base}-${n}.png`});
   await p.screenshot({path:`shots/full/${base}-${n}-full.png`,fullPage:true});
   if(process.env.APPROVE){await p.evaluate(()=>window.__approve());await p.waitForTimeout(+(process.env.WAIT||2600));await p.screenshot({path:`shots/full/${base}-${n}-approved.png`,fullPage:true});}
   await p.close();
  }}
 await b.close();
})();
