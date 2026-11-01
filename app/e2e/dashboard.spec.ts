import { expect, test, type Page } from '@playwright/test';
import { fuelHistoryPage } from './api-fixtures';
import { writeFile } from 'node:fs/promises';

// Controlled frontend fixtures only. These requests never reach accounts or a real database.
const vehicle = { id: 'dashboard-vehicle', nickname: 'Viagem teste', brand: 'Renault', model: 'Captur',
  allowedFuels: ['ETHANOL', 'GASOLINE_REGULAR'], version: 1, archivedAt: null };
export async function dashboardApi(page: Page) {
  await page.addInitScript(() => sessionStorage.setItem('fuellog.auth.refresh_token.v1', 'dashboard-refresh'));
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    let body: unknown = {};
    if (path.endsWith('/auth/refresh')) body = { access_token: 'dashboard-access', refresh_token: 'dashboard-refresh',
      token_type: 'Bearer', expires_in: 900, access_expires_at: new Date(Date.now()+900000).toISOString(),
      refresh_expires_at: new Date(Date.now()+86400000).toISOString(), session_id: 'dashboard-session' };
    else if (path.endsWith('/me')) body = { id: 'dashboard-user', name: 'Motorista teste', email: 'dashboard@example.test', preferredTimezone: 'America/Sao_Paulo' };
    else if (path.endsWith('/vehicles')) body = [vehicle, { ...vehicle, id: 'other-vehicle', nickname: 'Outro veículo' }];
    else if (path.endsWith(`/vehicles/${vehicle.id}`)) body = {...vehicle,...(route.request().method()==='PUT'?route.request().postDataJSON():{}),version:2};
    else if (path.endsWith('/fuel-types')) body = vehicle.allowedFuels;
    else if (path.endsWith('/dashboard')) body = dashboardFixture(url.searchParams);
    else if (path.endsWith('/fuel-entries')) body = fuelHistoryPage([]);
    else if (path.endsWith('/summary')) body = { paidTotal: '450.00', purchaseCount: 3, purchasedLiters: '90.000' };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
}
export function dashboardFixture(params = new URLSearchParams()) {
  const from = params.get('from'), to = params.get('to');
  const months = ['05','06','07','08','09','10'].map((month,i) => ({ month: `2026-${month}`,
    from: `2026-${month}-01`, to: `2026-${month}-${month === '06' || month === '09' ? 30 : 31}`,
    purchaseCount: 11, paidTotal: `${300+i*30}.00`, liters: `${60+i*6}.000` }));
  return { vehicleId: vehicle.id, from, to, timezone: params.get('timezone') ?? 'America/Sao_Paulo', fuelType: params.get('fuelType'),
    purchaseCount: 66, paidTotal: '2250.00', purchasedLiters: '450.000', weightedUnitPrice: '5.0000',
    months,
    fuels: [{ fuelType: 'ETHANOL', purchaseCount: 44, paidTotal: '1500.00', liters: '300.000', percentage: '66.6667' },
      { fuelType: 'GASOLINE_REGULAR', purchaseCount: 22, paidTotal: '750.00', liters: '150.000', percentage: '33.3333' }],
    prices: months.map((month,i) => ({ entryId: `price-${i}`, occurredAt: `${month.from}T12:00:00Z`, fuelType: 'ETHANOL',
      unitPrice: `${5.5-i*0.1}`, liters: '20.000', paidTotal: '100.00' })) };
}
test('four charts share one page and local filters, details and history preserve dashboard', async ({ page }) => {
  const historyQueries:URL[]=[];
  const removedRequests:string[]=[];
  page.on('request',request=>{if(request.url().includes('/consumption-cycles'))removedRequests.push(request.url());});
  page.on('request',request=>{if(request.url().includes('/fuel-entries?'))historyQueries.push(new URL(request.url()));});
  await dashboardApi(page);
  await page.goto('/');
  await expect(page.getByText('Visão geral', { exact: true })).toBeVisible();
  const ids = ['spending','fuel','price','liters'];
  for (const id of ids) await expect(page.getByTestId(`chart-${id}`)).toHaveCount(1);
  await expect(page.getByTestId('section-consumption')).toHaveCount(0);
  await expect(page.getByTestId('section-cost')).toHaveCount(0);
  const spending = page.getByTestId('section-spending');
  await spending.getByRole('button', { name: /Período/ }).click();
  await page.getByRole('button', { name: '3 meses', exact: true }).click();
  await expect(spending.getByRole('button', { name: /Período: 3 meses/ })).toBeVisible();
  await expect(page.getByTestId('section-price').getByRole('button', { name: /Período: 6 meses/ })).toHaveCount(1);
  await spending.getByTestId('chart-spending').click({ position: { x: 120, y: 100 } });
  await expect(page.getByTestId('tooltip-spending')).toBeVisible();
  await spending.getByRole('button', { name: 'Ver detalhes' }).click();
  const scrollBefore=await page.getByTestId('dashboard-scroll').evaluate(element=>element.scrollTop);
  await expect(page.getByRole('button', { name: 'Ver abastecimentos', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ver abastecimentos', exact: true }).click();
  await expect(page).toHaveURL(/history\?/);
  const expectedFrom=new URL(page.url()).searchParams.get('from');
  await expect.poll(()=>historyQueries.at(-1)?.searchParams.get('from')).toBe(expectedFrom);
  await page.getByRole('tab', { name: 'Início', exact: true }).click();
  await expect.poll(()=>page.getByTestId('dashboard-scroll').evaluate(element=>element.scrollTop)).toBe(scrollBefore);
  await expect(spending.getByRole('button', { name: /Período: 3 meses/ })).toBeVisible();
  expect(removedRequests).toEqual([]);
});

async function showChart(page: Page, id: string) {
  const chart = page.getByTestId(`chart-${id}`);
  await chart.evaluate(element => {
    const scroll = document.querySelector<HTMLElement>('[data-testid="dashboard-scroll"]')!;
    scroll.scrollTop += element.getBoundingClientRect().top - 190;
  });
  await expect(chart).toBeInViewport();
  return chart;
}
async function waitForArtwork(page:Page){
  await page.waitForFunction(()=>Array.from(document.images).filter(image=>image.src).every(image=>image.complete&&image.naturalWidth>0),undefined,{timeout:30000});
  await page.evaluate(async()=>{
    await document.fonts.ready;
    const urls=new Set<string>();
    for(const element of document.querySelectorAll('*')){
      for(const match of getComputedStyle(element).backgroundImage.matchAll(/url\(["']?([^"')]+)["']?\)/g))urls.add(match[1]);
    }
    await Promise.all([...urls].map(src=>new Promise<void>((resolve,reject)=>{
      const image=new Image();image.onload=()=>resolve();image.onerror=()=>reject(new Error(`Artwork failed: ${src}`));image.src=src;
    })));
  });
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
}

test('every chart selects, guides, details, accessible list and outside touch work', async ({ page }) => {
  await dashboardApi(page); await page.goto('/');
  await expect(page.getByTestId('chart-liters')).toHaveCount(1);
  for (const id of ['spending','fuel','price','liters']) {
    const chart = await showChart(page,id);
    await chart.click({position:{x:150,y:id==='fuel'?30:100}});
    const tooltip=page.getByTestId(`tooltip-${id}`);
    await expect(tooltip).toBeVisible();
    const bounds=await tooltip.boundingBox(), header=await page.getByTestId('dashboard-landscape').boundingBox();
    expect(bounds!.y).toBeGreaterThanOrEqual(header!.height-1);
    expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(844-104);
    if (id==='price') await expect(chart.locator('line[stroke-dasharray="3 4"]')).toHaveCount(1);
    await tooltip.getByRole('button',{name:'Ver detalhes',exact:true}).click();
    const dialog=page.getByRole('dialog');
    await expect(dialog.getByRole('button',{name:'Ver abastecimentos',exact:true})).toBeVisible();
    await dialog.getByRole('button',{name:'Fechar',exact:true}).click();
    await page.getByTestId(`section-${id}`).getByRole('button',{name:'Consultar dados em lista'}).click();
    await expect(page.getByRole('dialog').getByRole('button',{name:/Ver detalhes/}).first()).toBeVisible();
    await page.getByRole('dialog').getByRole('button',{name:/Ver detalhes/}).first().click();
    await expect(page.getByRole('dialog').getByRole('button',{name:'Ver abastecimentos',exact:true})).toBeVisible();
    await page.getByRole('dialog').getByRole('button',{name:'Fechar',exact:true}).click();
    await chart.click({position:{x:150,y:id==='fuel'?30:100}});
    const plotBounds=await chart.boundingBox();
    await page.mouse.click(4,Math.max(160,plotBounds!.y+20));
    await expect(tooltip).toHaveCount(0);
  }
});

test('calendar and fuel filters are local; scrolling and selection never request again', async ({page})=>{
  const requests:string[]=[];
  page.on('request',request=>{if(request.url().includes('/dashboard?')) requests.push(request.url());});
  await dashboardApi(page);await page.goto('/');
  await expect(page.getByTestId('chart-liters')).toHaveCount(1);
  expect(requests).toHaveLength(2);
  await showChart(page,'liters');await showChart(page,'price');
  expect(requests).toHaveLength(2);
  const filteredPrice=page.getByTestId('section-price');
  await filteredPrice.getByRole('button',{name:/Combustível:/}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Etanol',exact:true}).click();
  await expect(filteredPrice.getByRole('button',{name:/Combustível: Etanol/})).toBeVisible();
  await expect(filteredPrice.getByTestId('chart-price')).toHaveCount(1);
  expect(requests).toHaveLength(3);
  const liters=page.getByTestId('section-liters');await showChart(page,'liters');
  await liters.getByRole('button',{name:/Combustível:/}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Etanol',exact:true}).click();
  await expect(liters.getByTestId('chart-liters')).toHaveCount(1);
  expect(requests).toHaveLength(3);
  const price=page.getByTestId('section-price');await showChart(page,'price');
  await price.getByRole('button',{name:/Período:/}).click();
  await page.getByRole('button',{name:'Período personalizado',exact:true}).click();
  await page.getByRole('button',{name:/^18 de /}).click();
  await page.getByRole('button',{name:/^25 de /}).click();
  await page.getByRole('button',{name:'Usar período',exact:true}).click();
  await expect(price.getByRole('button',{name:/Período:.*18\/.*25\//})).toBeVisible();
  await expect.poll(()=>requests.length).toBe(4);
  const params=new URL(requests[3]).searchParams;
  expect(params.get('from')).toMatch(/-18$/);expect(params.get('to')).toMatch(/-25$/);
  await expect(page.getByTestId('section-spending').getByRole('button',{name:/Período: 6 meses/})).toHaveCount(1);
});

test('late responses from an old filter and vehicle never repaint current chart',async({page})=>{
  await dashboardApi(page);
  let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
  let sixFrom='';
  await page.route('**/dashboard?**',async route=>{
    const url=new URL(route.request().url());
    const data=dashboardFixture(url.searchParams);
    if(!sixFrom && url.searchParams.get('from')?.endsWith('-01') && url.searchParams.get('from')!==`2026-10-01`) sixFrom=url.searchParams.get('from')!;
    if(url.pathname.includes('dashboard-vehicle') && url.searchParams.get('from')===sixFrom){
      await gate;data.prices=data.prices.map(price=>({...price,unitPrice:'99.0000'}));
    }
    if(url.pathname.includes('other-vehicle')) data.prices=data.prices.map(price=>({...price,unitPrice:'4.1234'}));
    await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  });
  try {
    await page.goto('/');
    const price=page.getByTestId('section-price');
    await price.evaluate(element=>{const scroll=document.querySelector<HTMLElement>('[data-testid="dashboard-scroll"]')!;scroll.scrollTop+=element.getBoundingClientRect().top-160;});
    await price.getByRole('button',{name:/Período:/}).click();await page.getByRole('button',{name:'3 meses',exact:true}).click();
    await expect(price.getByText('R$ 5,00/L',{exact:true})).toHaveCount(1);
    release();
    await expect(price.getByText('R$ 99,00/L',{exact:true})).toHaveCount(0);
    await page.getByTestId('dashboard-vehicle').click();
    await page.getByRole('dialog').getByRole('button',{name:'Outro veículo',exact:true}).click();
    await expect(price.getByText('R$ 4,1234/L',{exact:true})).toHaveCount(1);
    await expect(price.getByText('R$ 99,00/L',{exact:true})).toHaveCount(0);
  } finally {release();}
});

test('header uses absolute offset continuously and stays compact away from the top',async({page})=>{
  let dashboardRequests=0;
  page.on('request',request=>{if(new URL(request.url()).pathname.endsWith('/dashboard'))dashboardRequests++;});
  await dashboardApi(page);await page.goto('/');await expect(page.getByTestId('chart-liters')).toHaveCount(1);
  await expect(page.getByTestId('dashboard-month-total')).toHaveText('R$ 2.250,00');
  await waitForArtwork(page);
  const requestsBeforeScroll=dashboardRequests;
  const header=page.getByTestId('dashboard-landscape');const scroll=page.getByTestId('dashboard-scroll');
  await page.emulateMedia({colorScheme:'light'});
  const captureHeader=async(name:string)=>{
    const box=(await header.boundingBox())!;
    await page.screenshot({path:test.info().outputPath(name),clip:{...box,height:box.height+48}});
    if(name.endsWith('-expanded.png')||name.endsWith('-390.png'))
      await page.screenshot({path:test.info().outputPath(name.replace('.png','-screen.png'))});
  };
  const expandedHeight=(await header.boundingBox())!.height;
  await scroll.evaluate(element=>{element.scrollTop=800;});
  await expect.poll(async()=>(await header.boundingBox())!.height).toBeLessThan(expandedHeight-100);
  const compactHeight=(await header.boundingBox())!.height;
  const heights:number[]=[];
  for(const y of [0,30,60,90,800,700,650,0]){
    await scroll.evaluate((element,y)=>{element.scrollTop=y;},y);
    await expect.poll(async()=>Math.round((await header.boundingBox())!.height)).toBe(Math.round(Math.max(compactHeight,expandedHeight-y)));
    heights.push((await header.boundingBox())!.height);
    if(y===60||y===90)await captureHeader(`header-transition-${y}.png`);
  }
  expect(heights[1]-heights[2]).toBeCloseTo(30,0);expect(heights[4]).toBe(heights[5]);
  expect(dashboardRequests).toBe(requestsBeforeScroll);
  await writeFile(test.info().outputPath('header-offsets.json'),JSON.stringify(heights));
  for(const theme of ['light','dark'] as const){
    await page.emulateMedia({colorScheme:theme});
    await expect(header).toHaveCSS('background-color',theme==='dark'?'rgb(8, 14, 24)':'rgb(245, 243, 238)');
    await page.setViewportSize({width:390,height:844});
    await scroll.evaluate(element=>{element.scrollTop=800;});
    const themeCompactHeight=theme==='light'?compactHeight:compactHeight-40;
    await expect.poll(async()=>(await header.boundingBox())!.height).toBe(themeCompactHeight);
    for(const y of [0,60,90]){
      await scroll.evaluate((element,y)=>{element.scrollTop=y;},y);
      await expect.poll(async()=>Math.round((await header.boundingBox())!.height)).toBe(Math.round(expandedHeight-y));
      await waitForArtwork(page);
      await captureHeader(`header-${theme}-${y===0?'expanded':`transition-${y}`}.png`);
    }
    for(const width of [390,320]){
      await page.setViewportSize({width,height:844});
      await scroll.evaluate(element=>{element.scrollTop=800;});
      await expect.poll(async()=>(await header.boundingBox())!.height).toBe(themeCompactHeight);
      await waitForArtwork(page);
      const logo=await page.getByRole('img',{name:'FuelLog',exact:true}).boundingBox();
      const avatar=await page.getByTestId('header-avatar-button').boundingBox();
      const selector=await page.getByTestId('dashboard-vehicle').boundingBox();
      const vehicleLabel=await page.getByTestId('dashboard-vehicle').getByText(vehicle.nickname,{exact:true}).boundingBox();
      expect(logo!.width).toBe(96);
      expect(vehicleLabel!.y).toBeGreaterThan(logo!.y+logo!.height);
      expect(selector!.x).toBe(logo!.x);
      expect(selector!.height).toBeGreaterThanOrEqual(44);
      expect(avatar!.width).toBeGreaterThanOrEqual(44);expect(avatar!.height).toBeGreaterThanOrEqual(44);
      await captureHeader(`header-${theme}-${width}.png`);
    }
  }
  expect(await page.getByTestId('dashboard-vehicle').evaluate(element=>{
    const box=element.getBoundingClientRect();return element.contains(document.elementFromPoint(box.x+5,box.y+2));
  })).toBe(true);
  await page.getByTestId('dashboard-vehicle').click({position:{x:5,y:2}});
  await page.getByRole('button',{name:'Outro veículo',exact:true}).click();
  await expect(page.getByTestId('dashboard-vehicle')).toHaveAccessibleName('Veículo selecionado: Outro veículo');
  const navigationScroll:number[]=[await scroll.evaluate(element=>element.scrollTop)];
  await page.getByTestId('header-avatar-button').click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByText('Conta',{exact:true})).toBeVisible();
  await page.getByTestId('account-back-button').click();
  navigationScroll.push(await scroll.evaluate(element=>element.scrollTop));
  for(const tab of ['Histórico','Veículos','Ajustes']){
    await page.getByRole('tab',{name:tab,exact:true}).click();
    await expect(page.getByTestId('header-avatar-button')).toBeVisible();
    await expect.poll(async()=>(await page.getByRole('img',{name:'FuelLog',exact:true}).boundingBox())!.width).toBe(146);
    await waitForArtwork(page);
  }
  await page.getByRole('tab',{name:'Início',exact:true}).click();
  await expect.poll(async()=>(await page.getByRole('img',{name:'FuelLog',exact:true}).boundingBox())!.width).toBe(96);
  navigationScroll.push(await scroll.evaluate(element=>element.scrollTop));
  await writeFile(test.info().outputPath('header-navigation-scroll.json'),JSON.stringify(navigationScroll));
  expect(navigationScroll).toEqual([800,800,800]);
  await expect.poll(async()=>(await header.boundingBox())!.height).toBe(compactHeight-40);
  await expect(page.getByTestId('dashboard-vehicle')).toHaveAccessibleName('Veículo selecionado: Outro veículo');
  await page.emulateMedia({colorScheme:'light'});
  await page.route('**/api/v1/vehicles',route=>route.fulfill({contentType:'application/json',body:JSON.stringify([
    {...vehicle,nickname:'Captur para viagem'}, {...vehicle,id:'other-vehicle',nickname:'Outro veículo'},
  ])}));
  await page.reload();await expect(page.getByTestId('chart-liters')).toHaveCount(1);
  await page.getByTestId('dashboard-vehicle').click();
  await page.getByRole('dialog').getByRole('button',{name:'Captur para viagem',exact:true}).click();
  await expect(page.getByTestId('dashboard-vehicle')).toHaveAccessibleName('Veículo selecionado: Captur para viagem');
  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});
    for(const y of [0,60,800]){
      await scroll.evaluate((element,y)=>{element.scrollTop=y;},y);
      await expect.poll(async()=>Math.round((await header.boundingBox())!.height)).toBe(Math.round(Math.max(compactHeight,width*0.74-y)));
      const label=page.getByTestId('dashboard-vehicle').getByText('Captur para viagem',{exact:true});
      const labelBox=(await label.boundingBox())!, logoBox=(await page.getByRole('img',{name:'FuelLog',exact:true}).boundingBox())!;
      expect(labelBox.height).toBe(40);
      expect(labelBox.y).toBeGreaterThanOrEqual(logoBox.y+logoBox.height+4);
      expect(labelBox.y+labelBox.height).toBeLessThan((await header.boundingBox())!.height);
      await waitForArtwork(page);
      await captureHeader(`header-light-two-lines-${width}-${y}.png`);
    }
  }
});

for(const theme of ['light','dark'] as const){
  test(`screenshots top middle bottom ${theme} and 320px enlarged fonts`,async({page})=>{
    await page.emulateMedia({colorScheme:theme});await dashboardApi(page);await page.goto('/');
    await expect(page.getByTestId('chart-liters')).toHaveCount(1);
    await waitForArtwork(page);
    await page.screenshot({path:test.info().outputPath(`${theme}-top.png`)});
    await showChart(page,'price');await page.screenshot({path:test.info().outputPath(`${theme}-middle.png`)});
    await showChart(page,'liters');await page.screenshot({path:test.info().outputPath(`${theme}-bottom.png`)});
    await page.setViewportSize({width:320,height:740});
    await page.evaluate(()=>{
      const enlarged=new WeakSet<HTMLElement>();
      const apply=()=>{for(const node of document.querySelectorAll<HTMLElement>('[data-testid^="section-"] [dir="auto"]')){
        if(enlarged.has(node))continue;enlarged.add(node);
        const style=getComputedStyle(node);node.style.fontSize=`${parseFloat(style.fontSize)*1.5}px`;node.style.lineHeight=`${parseFloat(style.lineHeight)*1.5}px`;
      }};
      apply();const observer=new MutationObserver(apply);observer.observe(document.body,{childList:true,subtree:true});
    });
    await showChart(page,'price');const chart=page.getByTestId('chart-price');
    await chart.click({position:{x:160,y:100}});
    const tip=page.getByTestId('tooltip-price');await expect(tip).toBeVisible();
    const box=await tip.boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(320);
    expect(box!.y+box!.height).toBeLessThanOrEqual(740-104);
    await page.screenshot({path:test.info().outputPath(`${theme}-320-large.png`)});
  });
}

async function recordSvg(page:Page,selector:string,attribute:string,action:()=>Promise<unknown>,name:string){
  await page.evaluate(({selector,attribute})=>{
    (window as any).dashboardFrames=[];
    (window as any).dashboardCaptureEnd=Infinity;
    (window as any).dashboardCapture=new Promise(resolve=>{
      const start=performance.now();
      const frame=()=>{
        const element=document.querySelector(selector);
        (window as any).dashboardFrames.push({time:performance.now()-start,value:Number(element?.getAttribute(attribute)??0),
          svgWidth:Number(element?.closest('svg')?.getAttribute('width')??0)});
        if(performance.now()<(window as any).dashboardCaptureEnd)requestAnimationFrame(frame);else resolve((window as any).dashboardFrames);
      };requestAnimationFrame(frame);
    });
  },{selector,attribute});
  await action();
  await page.evaluate(()=>{(window as any).dashboardCaptureEnd=performance.now()+850;});
  const frames=await page.evaluate(()=>(window as any).dashboardCapture) as {time:number;value:number;svgWidth:number}[];
  await writeFile(test.info().outputPath(`${name}-frames.json`),JSON.stringify(frames));
  return frames;
}
async function recordPriceDrawing(page:Page,action:()=>Promise<unknown>,name:string){
  await page.evaluate(()=>{
    (window as any).priceCapture=new Promise(resolve=>{
      const frames:any[]=[],start=performance.now();
      const frame=()=>{
        const svg=document.querySelector<SVGSVGElement>('[data-testid="chart-price"] svg')!;
        frames.push({time:performance.now()-start,width:Number(svg.querySelector('clipPath rect')!.getAttribute('width')),
          svg:new XMLSerializer().serializeToString(svg)});
        if(performance.now()-start<900)requestAnimationFrame(frame);else resolve(frames);
      };frame();
    });
  });
  await action();
  const frames=await page.evaluate(()=>(window as any).priceCapture) as {time:number;width:number;svg:string}[];
  const final=frames.at(-1)!.width;
  const middle=frames.find(frame=>frame.width>final*0.45&&frame.width<final*0.7)!;
  expect(middle,'an actual intermediate SVG frame').toBeDefined();
  const painted=await page.evaluate(async snapshots=>Promise.all(snapshots.map(async frame=>{
    const image=new Image();image.src=`data:image/svg+xml;charset=utf-8,${encodeURIComponent(frame.svg)}`;await image.decode();
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
    const context=canvas.getContext('2d')!;
    const svg=new DOMParser().parseFromString(frame.svg,'image/svg+xml').documentElement;
    context.fillStyle=svg.querySelector('path')!.getAttribute('stroke')!;context.fillRect(0,0,1,1);
    const brand=[...context.getImageData(0,0,1,1).data];context.clearRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0);
    const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;
    const points=[...svg.querySelectorAll('circle')].map(point=>({x:Number(point.getAttribute('cx')),y:Number(point.getAttribute('cy'))}));
    const isBrand=(x:number,y:number)=>{
      const offset=(Math.round(y)*canvas.width+Math.round(x))*4;
      return pixels[offset+3]>100&&brand.slice(0,3).every((value,index)=>Math.abs(pixels[offset+index]-value)<8);
    };
    let linePixels=0,front=-1;
    for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
      if(isBrand(x,y)&&points.every(point=>Math.hypot(point.x-x,point.y-y)>8)){linePixels++;front=Math.max(front,x);}
    }
    return {linePixels,front,points:points.map(point=>isBrand(point.x,point.y)),
      labelsOpacity:Number(svg.querySelector(':scope > g:last-child')!.getAttribute('opacity')),
      clipRule:svg.querySelector('g[clip-path]')!.getAttribute('clip-rule'),png:canvas.toDataURL(),svg:frame.svg,time:frame.time};
  })),[frames[0],middle,frames.at(-1)!]);
  for(const [index,phase] of ['start','middle','end'].entries()){
    await writeFile(test.info().outputPath(`${name}-${phase}.png`),Buffer.from(painted[index].png.split(',')[1],'base64'));
    await writeFile(test.info().outputPath(`${name}-${phase}.svg`),painted[index].svg);
  }
  await writeFile(test.info().outputPath(`${name}-frames.json`),JSON.stringify(frames.map(({svg,...frame})=>frame)));
  await writeFile(test.info().outputPath(`${name}-painted.json`),JSON.stringify(painted.map(({svg,png,...frame})=>frame)));
  return {frames,painted};
}

test.describe('viewport animations',()=>{
  test.use({reducedMotion:'no-preference',viewport:{width:390,height:650}});
  test('waits for drawing, reveals SVG, never replays equal datasets and defers changed hidden series',async({page})=>{
    test.setTimeout(90000);
    await dashboardApi(page);
    let changed=false;
    await page.route('**/dashboard?**',route=>{
      const data=dashboardFixture(new URL(route.request().url()).searchParams);
      if(changed){data.months=data.months.map(month=>({...month,paidTotal:(Number(month.paidTotal)+75).toFixed(2)}));data.prices=data.prices.map(price=>({...price,unitPrice:(Number(price.unitPrice)+1).toFixed(4)}));}
      return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
    });
    await page.goto('/');await expect(page.getByTestId('chart-liters')).toHaveCount(1);await waitForArtwork(page);
    const barSelector='[data-testid="chart-spending"] svg > rect';
    const bar=page.locator(barSelector).first();
    const waiting=await recordSvg(page,barSelector,'height',async()=>{},'outside');
    expect(waiting.every(frame=>frame.value===0)).toBe(true);
    const reveal=await recordSvg(page,barSelector,'height',async()=>{
      await showChart(page,'spending');
      await page.waitForFunction(()=> (window as any).dashboardFrames.some((frame:any)=>frame.value>5));
      await page.screenshot({path:test.info().outputPath('bar-real-intermediate.png')});
    },'spending-reveal');
    const final=Number(await bar.getAttribute('height'));
    expect(reveal.some(frame=>frame.value>0&&frame.value<final-1)).toBe(true);
    expect(reveal.at(-1)!.value).toBeCloseTo(final,1);
    await page.screenshot({path:test.info().outputPath('bar-real-final.png')});
    const noReplay=await recordSvg(page,barSelector,'height',async()=>{
      await page.getByTestId('chart-spending').click({position:{x:150,y:100}});
      await showChart(page,'fuel');await showChart(page,'spending');
    },'selection-scroll-no-replay');
    expect(noReplay.every(frame=>Math.abs(frame.value-final)<0.1)).toBe(true);
    const saveVehicle=async()=>{
      await page.getByRole('tab',{name:'Veículos',exact:true}).click();
      await page.getByTestId('edit-vehicle-button').click();
      await page.getByTestId('vehicle-form-submit-button').click();
      await expect(page.getByText('Editar veículo',{exact:true})).toHaveCount(0);
      await page.getByRole('tab',{name:'Início',exact:true}).click();
      await expect(bar).toHaveCount(1);
    };
    const equal=await recordSvg(page,barSelector,'height',saveVehicle,'equal-dataset-refetch');
    // During loading the drawing can be absent; every painted replacement starts at its final geometry.
    expect(equal.filter(frame=>frame.value>0).every(frame=>Math.abs(frame.value-final)<0.1)).toBe(true);
    changed=true;await saveVehicle();
    const priceClip=page.getByTestId('chart-price').locator('clipPath rect');
    await expect(priceClip).toHaveAttribute('width','0');
    const priceWaiting=await recordSvg(page,'[data-testid="chart-price"] clipPath rect','width',async()=>{
      await page.getByTestId('chart-price').evaluate(element=>{
        const scroll=document.querySelector<HTMLElement>('[data-testid="dashboard-scroll"]')!;
        // Only 60px of the drawing clears the dock, below its 35% visibility threshold.
        scroll.scrollTop+=element.getBoundingClientRect().top-(window.innerHeight-104-60);
      });
    },'price-waits-for-useful-viewport');
    expect(priceWaiting.every(frame=>frame.value===0)).toBe(true);
    // Android must take the uncached ClipPath branch; web alone cannot reproduce its stale native cache.
    await expect(page.getByTestId('chart-price').locator('g[clip-path]')).toHaveAttribute('clip-rule','nonzero');
    const {frames:line,painted}=await recordPriceDrawing(page,async()=>{
      await showChart(page,'price');
      await page.waitForFunction(()=> Number(document.querySelector('[data-testid="chart-price"] clipPath rect')?.getAttribute('width'))>160);
      await page.screenshot({path:test.info().outputPath('line-real-intermediate.png')});
    },'changed-price-reveal');
    const lineFinal=Number(await priceClip.getAttribute('width'));
    const clipMargin=Number(await page.getByTestId('chart-price').locator('svg').getAttribute('width'))-lineFinal;
    expect(line.some(frame=>frame.width>0&&frame.width<lineFinal-1)).toBe(true);
    const started=line.find(frame=>frame.width>0)!,completed=line.find(frame=>frame.width===lineFinal)!;
    expect(completed.time-started.time).toBeGreaterThanOrEqual(500);expect(completed.time-started.time).toBeLessThanOrEqual(800);
    expect(painted[0].linePixels).toBe(0);expect(painted[0].points.every(point=>!point)).toBe(true);
    expect(painted[1].linePixels).toBeGreaterThan(0);expect(painted[1].linePixels).toBeLessThan(painted[2].linePixels);
    expect(painted[1].front).toBeLessThan(painted[2].front);
    expect(painted[1].points.some(Boolean)&&painted[1].points.some(point=>!point)).toBe(true);
    expect(painted[2].points.every(Boolean)).toBe(true);
    expect(painted.map(frame=>frame.labelsOpacity)).toEqual([0,0,1]);
    await page.screenshot({path:test.info().outputPath('line-real-final.png')});
    const requests:string[]=[];page.on('request',request=>{if(request.url().includes('/dashboard?'))requests.push(request.url());});
    const priceNoReplay=await recordSvg(page,'[data-testid="chart-price"] clipPath rect','width',async()=>{
      await page.getByTestId('chart-price').click({position:{x:150,y:100}});
      await expect(page.getByTestId('tooltip-price')).toBeVisible();
      await showChart(page,'liters');await showChart(page,'price');
    },'price-selection-scroll-no-replay');
    expect(priceNoReplay.every(frame=>frame.value===lineFinal)).toBe(true);expect(requests).toHaveLength(0);
    const priceEqual=await recordSvg(page,'[data-testid="chart-price"] clipPath rect','width',saveVehicle,'price-equal-dataset');
    const settled=priceEqual.filter(frame=>frame.svgWidth>0);
    expect(settled.length).toBeGreaterThan(10);
    expect(settled.every(frame=>frame.value===frame.svgWidth-clipMargin)).toBe(true);
  });
  test('stacked segments keep proportions while revealing; background cancels without replay',async({page})=>{
    await dashboardApi(page);await page.goto('/');await expect(page.getByTestId('chart-fuel')).toHaveCount(1);
    const selector='[data-testid="chart-fuel"] svg > g > rect';
    const segments=page.locator(selector);
    const capture=await recordSvg(page,selector,'width',async()=>{
      await showChart(page,'fuel');
      await page.waitForFunction(()=>Number(document.querySelector('[data-testid="chart-fuel"] svg > g > rect')?.getAttribute('width'))>10);
      const widths=await segments.evaluateAll(nodes=>nodes.map(node=>Number(node.getAttribute('width'))));
      expect(widths[0]/widths[1]).toBeCloseTo(2,1);
      await page.screenshot({path:test.info().outputPath('stack-real-intermediate.png')});
      await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
      await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'));});
    },'stack-background');
    const final=Number(await segments.first().getAttribute('width'));
    expect(capture.some(frame=>frame.value>0&&frame.value<final-1)).toBe(true);
    expect(capture.at(-1)!.value).toBeCloseTo(final,1);
  });
});

test('price respects reduced motion and background cancellation without replay',async({page})=>{
  test.setTimeout(90000);
  await dashboardApi(page);await page.goto('/');await expect(page.getByTestId('chart-price')).toHaveCount(1);
  const selector='[data-testid="chart-price"] clipPath rect',clip=page.locator(selector);
  await showChart(page,'price');
  const final=Number(await clip.getAttribute('width'));
  expect(final).toBeGreaterThan(200);
  const reduced=await recordSvg(page,selector,'width',async()=>{},'price-reduced-motion');
  expect(reduced.every(frame=>frame.value===final)).toBe(true);
  await expect(page.getByTestId('chart-price').locator('svg > g').last()).toHaveAttribute('opacity','1');
  await page.emulateMedia({reducedMotion:'no-preference'});await page.reload({waitUntil:'domcontentloaded'});await expect(clip).toHaveAttribute('width','0');
  const paused=await recordSvg(page,selector,'width',async()=>{
    await showChart(page,'price');
    await page.waitForFunction(()=>Number(document.querySelector('[data-testid="chart-price"] clipPath rect')?.getAttribute('width'))>20);
    await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
    await expect(clip).toHaveAttribute('width',String(final));
    await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'));});
    await showChart(page,'spending');await showChart(page,'price');
  },'price-background');
  expect(paused.some(frame=>frame.value>0&&frame.value<final)).toBe(true);
  const complete=paused.findIndex(frame=>frame.value===final);
  expect(complete).toBeGreaterThan(0);expect(paused.slice(complete).every(frame=>frame.value===final)).toBe(true);
});

test('individual errors retry, empty purchases draw no artificial data; a single price remains selectable',async({page})=>{
  await dashboardApi(page);let fail=true;
  await page.route('**/dashboard?**',route=>{
    const url=new URL(route.request().url());const data=dashboardFixture(url.searchParams);
    if(url.searchParams.get('from')==='2026-08-01' && fail)return route.fulfill({status:503,contentType:'application/problem+json',body:JSON.stringify({detail:'Gráfico temporariamente indisponível.'})});
    if(url.searchParams.get('fuelType')==='ETHANOL'){
      data.months=[];data.fuels=[];data.prices=data.prices.slice(0,1);    }
    return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto('/');await expect(page.getByTestId('chart-liters')).toHaveCount(1);
  const price=page.getByTestId('section-price');await showChart(page,'price');
  await price.getByRole('button',{name:/Período:/}).click();await page.getByRole('button',{name:'3 meses',exact:true}).click();
  await expect(price.getByText('Gráfico temporariamente indisponível.',{exact:true})).toBeVisible();
  await expect(page.getByTestId('chart-spending')).toHaveCount(1);
  fail=false;await price.getByRole('button',{name:'Tentar novamente',exact:true}).click();await expect(page.getByTestId('chart-price').locator('path')).toHaveCount(1);
  const spending=page.getByTestId('section-spending');await showChart(page,'spending');
  await spending.getByRole('button',{name:/Combustível:/}).click();await page.getByRole('dialog').getByRole('button',{name:'Etanol',exact:true}).click();
  await expect(spending.getByText('Nenhum abastecimento neste período e combustível.',{exact:true})).toBeVisible();
  await showChart(page,'price');await price.getByRole('button',{name:/Combustível:/}).click();await page.getByRole('dialog').getByRole('button',{name:'Etanol',exact:true}).click();
  await expect(price.getByTestId('chart-price').locator('circle')).toHaveCount(1);
  await price.getByTestId('chart-price').click({position:{x:160,y:100}});await expect(page.getByTestId('tooltip-price')).toBeVisible();
});
