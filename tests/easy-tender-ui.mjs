import { chromium } from "playwright";
import assert from "node:assert/strict";

const browser=await chromium.launch({headless:true});
const errors=[];
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.on("pageerror",e=>errors.push(String(e)));
  await page.goto("http://127.0.0.1:8080/easy-tender.html",{waitUntil:"domcontentloaded"});
  await page.getByRole("button",{name:"Seed Demo Tender"}).click();
  const req=Number((await page.locator("#kDocs").textContent())||0);
  assert.ok(req>=5,"Seed demo did not populate submission pack");
  await page.getByRole("button",{name:"Submission Gate"}).click();
  await page.locator("#gateView.active").waitFor();
  assert.match(await page.locator("#gateSummary").innerText(),/blocker|READY/i);

  const desktopOverflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  assert.ok(desktopOverflow<=2,"Unexpected desktop horizontal overflow: "+desktopOverflow);

  await page.setViewportSize({width:390,height:844});
  const mobileOverflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  assert.ok(mobileOverflow<=2,"Unexpected mobile horizontal overflow: "+mobileOverflow);

  const menu=page.locator("[data-menu-toggle]");
  if(await menu.count()){
    await menu.click();
    assert.equal(await menu.getAttribute("aria-expanded"),"true","Mobile menu did not open");
  }

  const renderMs=await page.evaluate(()=>{
    const sample=Array.from({length:180},(_,i)=>({id:"load"+i,text:"Mandatory requirement "+i,category:"General",mandatory:true,status:"missing",owner:"",evidence:"",source:"Synthetic"}));
    const docs=Array.from({length:30},(_,i)=>({id:"doc"+i,type:"Schedule",title:"Submission item "+i,mandatory:true,conditional:false,status:"missing",owner:"",fileName:"",response:"",notes:"",source:"Synthetic",detail:""}));
    const t=performance.now();
    state.requirements=sample;
    state.submissionItems=docs;
    renderAll();
    return performance.now()-t;
  });
  assert.ok(renderMs<1200,"Rendering 180 requirements exceeded 1.2s: "+renderMs.toFixed(1)+"ms");
  assert.equal(errors.length,0,"Browser page errors: "+errors.join(" | "));
  console.log(JSON.stringify({status:"PASS",seedSubmissionItems:req,desktopOverflow,mobileOverflow,render180Ms:Number(renderMs.toFixed(1)),pageErrors:errors.length},null,2));
}finally{
  await browser.close();
}
