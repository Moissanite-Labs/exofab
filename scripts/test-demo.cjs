const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE ? {executablePath:process.env.CHROMIUM_EXECUTABLE} : {}),args:['--no-sandbox']});
 for(const width of [1440,390,320]){
  const mobile=width<760;
  const context=await browser.newContext({viewport:{width,height:mobile?844:1000},reducedMotion:'reduce',acceptDownloads:true});
  const page=await context.newPage();const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
  const url='file://'+path.resolve(__dirname,'../site/index.html');await page.goto(url);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal overflow');
  await page.locator('#demoMotion').click();assert.equal(await page.locator('#demoMotion').getAttribute('aria-pressed'),'true');
  await page.locator('.node[tabindex]').first().focus();assert.equal(await page.locator('#tip').evaluate(e=>e.classList.contains('on')),true);
  if(mobile){await page.locator('#srcToggle').click();assert.equal(await page.locator('#srcToggle').getAttribute('aria-expanded'),'false');}
  await page.locator('.ref').first().click();assert(await page.locator('#src-1').evaluate(e=>e===document.activeElement));
  await page.locator('#decline').click();await page.locator('#why').fill('<img src=x onerror=alert(1)>');await page.locator('#cancelDecline').click();assert(await page.locator('#decline').evaluate(e=>e===document.activeElement));
  await page.locator('#revise').click();assert.match(await page.locator('#outcome').innerText(),/No agent was contacted/);assert.equal(await page.locator('#outcome').evaluate(e=>getComputedStyle(e).opacity),'1');
  await page.locator('#approve').focus();await page.keyboard.press('Enter');await page.locator('#revoke').waitFor();assert.match(await page.locator('#outcome').innerText(),/No invites were sent/);
  assert.equal(await page.locator('#trace .new').count(),1);assert.equal(await page.locator('#outcome').evaluate(e=>getComputedStyle(e).opacity),'1');assert.equal(await page.locator('#trace .new').evaluate(e=>getComputedStyle(e).opacity),'1');
  await page.waitForFunction(()=>document.querySelector('#ms').classList.contains('on'));assert.equal(await page.locator('.stage[aria-current=step] .t').innerText(),'Build');
  await page.locator('#revoke').click();await page.waitForTimeout(1500);assert.equal(await page.locator('#ms').evaluate(e=>e.classList.contains('on')),false);
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#demoExport').click()]);const file=await download.path();const log=JSON.parse(require('fs').readFileSync(file,'utf8'));assert.equal(log.synthetic,true);assert.equal(log.verified,false);assert.equal(log.state,'revoked');assert.deepEqual(log.events.map(x=>x.action),['revision_requested','approved','revoked']);
  await page.locator('#demoReset').click();await page.waitForLoadState();assert.equal(await page.locator('#pill').innerText(),'Unsigned');
  await page.locator('#demoMotion').click();await page.locator('#decline').click();await page.locator('#why').fill('<img src=x onerror=alert(1)>');await page.locator('#confirmDecline').click();assert.equal(await page.locator('#outcome').evaluate(e=>getComputedStyle(e).opacity),'1');assert.match(await page.locator('#outcome').innerText(),/<img/);assert.equal(await page.locator('#outcome img').count(),0);
  await page.screenshot({path:path.resolve(__dirname,`../${mobile?'mobile':'desktop'}.png`),fullPage:true});
  assert.deepEqual(errors,[]);assert.equal(requests.filter(x=>/^https?:/.test(x)).length,0,'no external requests');
  console.log(`${width}px: interaction checks passed, zero page errors, zero external requests`);await context.close();
 }
 // Immediate revoke during the delayed milestone is also safe with normal motion.
 const page=await browser.newPage();await page.goto('file://'+path.resolve(__dirname,'../site/index.html'));await page.locator('#approve').dblclick();await page.locator('#revoke').waitFor();await page.locator('#revoke').click();await page.waitForTimeout(1800);assert.equal(await page.locator('#ms').evaluate(e=>e.classList.contains('on')),false);assert.equal(await page.locator('#trace .new').count(),2);console.log('normal-motion double-click + immediate revoke: passed');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
