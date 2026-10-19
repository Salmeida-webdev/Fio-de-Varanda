const demoCatalog = await fetch('/src/products.json').then(r => r.json());
const backendCatalog = await loadBackendCatalog().catch(() => []);
const savedDemoCatalog = JSON.parse(localStorage.getItem('fio-admin-catalog-v2')||'null');
// O Supabase só passa a ser fonte do catálogo quando houver produtos publicados.
// Até lá, a vitrine preserva o catálogo de portfólio e mantém as compras desativadas.
const productData = backendCatalog.length ? backendCatalog : (savedDemoCatalog || demoCatalog);
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const priceFor=(product,variant)=>Number(product?.variantPrices?.[variant]??product?.price??0);
function safeImageUrl(value,fallback='/images/fio-de-varanda-hero.webp'){
 if(typeof value!=='string')return fallback;
 if(value.startsWith('/')&&!value.startsWith('//'))return value;
 try{const url=new URL(value);return url.protocol==='https:'?url.href:fallback}catch{return fallback}
}
async function loadBackendCatalog(){
 const config=window.FIO_STORE_CONFIG;
 if(!config?.supabaseUrl||!config?.supabasePublishableKey)return [];
 const select='id,category_id,name,slug,description,details,featured,categories(name,slug),product_images(storage_path,alt_text,sort_order,is_primary),product_variants!inner(id,sku,option_values,price_cents,weight_grams,dimensions_mm,active)';
 const endpoint=new URL('/rest/v1/products',config.supabaseUrl);
 endpoint.search=new URLSearchParams({select,status:'eq.active',order:'featured.desc,name.asc'}).toString();
 const response=await fetch(endpoint,{headers:{apikey:config.supabasePublishableKey}});
 if(!response.ok)throw new Error(`Catálogo Supabase indisponível (${response.status})`);
 const rows=await response.json();
 return rows.map(row=>{
  const demo=demoCatalog.find(item=>item.slug===row.slug);
  const variants=(row.product_variants||[]).filter(item=>item.active);
  const options=variants.map(item=>({record:item,label:Object.values(item.option_values||{}).filter(Boolean).join(' · ')||item.sku}));
  const primary=(row.product_images||[]).slice().sort((a,b)=>(Number(b.is_primary)-Number(a.is_primary))||a.sort_order-b.sort_order)[0];
  const path=primary?.storage_path;
  const storageImage=path?`${config.supabaseUrl.replace(/\/$/,'')}/storage/v1/object/public/product-images/${path.split('/').map(encodeURIComponent).join('/')}`:'';
  const image=storageImage?(safeImageUrl(storageImage,demo?.image||'/images/fio-de-varanda-hero.webp')):(demo?.image||'/images/fio-de-varanda-hero.webp');
  const labels=options.map(item=>item.label);
  const variantPrices=Object.fromEntries(options.map(item=>[item.label,Number(item.record.price_cents||0)/100]));
  return {id:row.id,slug:row.slug,name:row.name,category:row.categories?.slug||'outros',categoryName:row.categories?.name||'Coleção',price:Number(variants[0]?.price_cents||0)/100,variantPrices,description:row.description,details:Array.isArray(row.details)?row.details:[],variants:labels.length?labels:['Único'],variantRecords:options.map(item=>item.record),image,featured:row.featured,sku:variants[0]?.sku||'',imageAlt:primary?.alt_text||row.name};
 });
}
const money = n => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n);
const featured = productData.filter(p=>p.featured);
const grid = document.querySelector('#product-grid');
const featuredGrid = document.querySelector('#featured-grid');
let cart = JSON.parse(localStorage.getItem('fio-cart')||'[]');
let currentFilter = 'all', currentSort='featured', query='';
const variantLabel=record=>Object.values(record?.option_values||{}).filter(Boolean).join(' · ')||record?.sku||'';
function normalized(value){return String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase()}
function productForCart(item){
 const direct=productData.find(product=>String(product.id)===String(item.id));
 if(direct)return direct;
 const oldProduct=demoCatalog.find(product=>String(product.id)===String(item.id));
 const slug=item.productSlug||item.product_slug||item.slug||oldProduct?.slug;
 if(slug){const bySlug=productData.find(product=>product.slug===slug);if(bySlug)return bySlug}
 const sku=item.variantSku||item.variant_sku||item.sku;
 if(sku){const bySku=productData.find(product=>(product.variantRecords||[]).some(record=>record.sku===sku));if(bySku)return bySku}
 const name=item.productName||item.product_name||item.name;
 if(name){const byName=productData.find(product=>normalized(product.name)===normalized(name));if(byName)return byName}
 return null;
}
function variantRecordFor(product,label,variantId,variantSku){
 const records=product?.variantRecords||[];
 return records.find(record=>record.id===variantId)
  ||records.find(record=>record.sku===variantSku)
  ||records.find(record=>variantLabel(record)===label)
  ||((!label||label==='Único')?records[0]:null);
}
// Atualiza itens guardados por versões anteriores: o antigo botão rápido
// gravava "Único" e catálogos locais usavam IDs diferentes dos IDs do Supabase.
cart=cart.map(item=>{
 const product=productForCart(item);
 if(!product)return item;
 const record=variantRecordFor(product,item.variant,item.variantId,item.variantSku||item.variant_sku||item.sku);
 const variant=record?variantLabel(record):(item.variant||product.variants?.[0]||'Único');
 return {...item,id:product.id,productSlug:product.slug,productName:product.name,variant,variantId:record?.id||item.variantId,variantSku:record?.sku||item.variantSku||item.variant_sku||item.sku,qty:Math.max(1,Number(item.qty)||1)};
});
localStorage.setItem('fio-cart',JSON.stringify(cart));
const toast = msg => {const el=document.querySelector('#toast');el.textContent=msg;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2300)};
const card = p => `<article class="product-card"><button class="product-image-button" data-detail="${escapeHTML(p.id)}" aria-label="Ver ${escapeHTML(p.name)}"><span class="product-photo-frame"><img src="${escapeHTML(safeImageUrl(p.image))}" alt="${escapeHTML(p.imageAlt)}" loading="lazy" width="520" height="520"></span><span class="product-badge">${escapeHTML(p.categoryName)}</span></button><div class="product-info"><h3 class="product-name">${escapeHTML(p.name)}</h3><strong class="product-price">${money(p.price)}</strong><p class="product-variant-hint">${p.variants.length>1?`${p.variants.length} opções demonstrativas`:'Peça demonstrativa'}</p></div><div class="product-actions"><button data-detail="${escapeHTML(p.id)}">Detalhes</button><button class="add-button" data-add="${escapeHTML(p.id)}">Adicionar</button></div></article>`;
function renderProducts(){
 let list=productData.filter(p=>(currentFilter==='all'||p.category===currentFilter)&&(!query||`${p.name} ${p.categoryName}`.toLowerCase().includes(query.toLowerCase())));
 if(currentSort==='low')list.sort((a,b)=>a.price-b.price);else if(currentSort==='high')list.sort((a,b)=>b.price-a.price);else if(currentSort==='name')list.sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
 grid.innerHTML=list.map(card).join('');
 document.querySelector('#results-count').textContent=`${list.length} ${list.length===1?'produto':'produtos'} demonstrativos`;
}
function saveCart(){localStorage.setItem('fio-cart',JSON.stringify(cart));renderCart()}
function addToCart(id,variant){let p=productData.find(x=>x.id===id);if(!p)return;const record=variantRecordFor(p,variant||p.variants?.[0]);const label=record?variantLabel(record):(variant||p.variants?.[0]||'Único');let item=cart.find(x=>x.id===id&&(record?x.variantId===record.id:x.variant===label));if(item)item.qty++;else cart.push({id,productSlug:p.slug,productName:p.name,variant:label,variantId:record?.id,variantSku:record?.sku,qty:1});saveCart();toast(`${p.name} adicionado à sacola`)}
function renderCart(){
 const count=cart.reduce((a,x)=>a+(Number(x.qty)||0),0), total=cart.reduce((a,x)=>{const p=productData.find(y=>y.id===x.id);return a+(p?priceFor(p,x.variant)*(Number(x.qty)||0):0)},0);
 document.querySelector('#cart-count').textContent=count;document.querySelector('#cart-count-panel').textContent=count;document.querySelector('#cart-subtotal').textContent=money(total);
 document.querySelector('#cart-items').innerHTML=cart.length?cart.map(x=>{const p=productForCart(x);if(!p)return '';const key=x.variantId||x.variant;return `<div class="cart-item"><img src="${escapeHTML(safeImageUrl(p.image))}" alt=""><div><h3>${escapeHTML(p.name)}</h3><small>${escapeHTML(x.variant)} · ${money(priceFor(p,x.variant))}</small><div class="qty-control"><button data-qty="${escapeHTML(x.id)}" data-variant-key="${escapeHTML(key)}" data-delta="-1" aria-label="Diminuir quantidade">−</button><span>${Number(x.qty)||0}</span><button data-qty="${escapeHTML(x.id)}" data-variant-key="${escapeHTML(key)}" data-delta="1" aria-label="Aumentar quantidade">+</button></div></div><button class="remove-item" data-remove="${escapeHTML(x.id)}" data-variant="${escapeHTML(x.variant)}" data-variant-id="${escapeHTML(x.variantId||'')}">Remover</button></div>`}).join(''):'<p class="empty-cart">Sua sacola está esperando uma escolha boa.</p>';
}
function openCart(){document.querySelector('#overlay').classList.add('open');document.querySelector('#cart-panel').classList.add('open');document.querySelector('#cart-panel').setAttribute('aria-hidden','false')}
function closeCart(){document.querySelector('#overlay').classList.remove('open');document.querySelector('#cart-panel').classList.remove('open');document.querySelector('#cart-panel').setAttribute('aria-hidden','true')}
function showDetail(id){const p=productData.find(x=>x.id===id);if(!p)return;const dlg=document.querySelector('#product-dialog');document.querySelector('#dialog-content').innerHTML=`<div class="dialog-product"><img src="${escapeHTML(safeImageUrl(p.image))}" alt="${escapeHTML(p.imageAlt)}"><div class="dialog-product-copy"><p class="eyebrow">${escapeHTML(p.categoryName.toUpperCase())} · ${escapeHTML(p.sku)}</p><h2>${escapeHTML(p.name)}</h2><strong class="price" id="detail-price">${money(priceFor(p,p.variants[0]))}</strong><p>${escapeHTML(p.description)}</p><ul>${p.details.map(d=>`<li>${escapeHTML(d)}</li>`).join('')}</ul><label for="variant-choice">Escolha uma opção</label><select id="variant-choice">${p.variants.map(v=>`<option>${escapeHTML(v)}</option>`).join('')}</select><button class="button button-dark full-width" data-add="${escapeHTML(p.id)}" id="dialog-add">Adicionar à sacola</button></div></div>`;dlg.showModal();const choice=document.querySelector('#variant-choice');choice.addEventListener('change',()=>{document.querySelector('#detail-price').textContent=money(priceFor(p,choice.value))});document.querySelector('#dialog-add').addEventListener('click',()=>{addToCart(p.id,choice.value);dlg.close()})}
document.addEventListener('click',e=>{
 const detail=e.target.closest('[data-detail]');if(detail)showDetail(detail.dataset.detail);
 const add=e.target.closest('[data-add]');if(add&&!add.id)addToCart(add.dataset.add);
 const qty=e.target.closest('[data-qty]');if(qty){const item=cart.find(x=>x.id===qty.dataset.qty&&(x.variantId||x.variant)===qty.dataset.variantKey);if(item){item.qty+=Number(qty.dataset.delta);if(item.qty<1)cart=cart.filter(x=>x!==item);saveCart()}}
 const rem=e.target.closest('[data-remove]');if(rem){cart=cart.filter(x=>!(x.id===rem.dataset.remove&&(rem.dataset.variantId?x.variantId===rem.dataset.variantId:x.variant===rem.dataset.variant)));saveCart()}
 const cat=e.target.closest('[data-category-link]');if(cat){currentFilter=cat.dataset.categoryLink;document.querySelector('#category-filter').value=currentFilter;renderProducts()}
});
document.querySelector('#category-filter').addEventListener('change',e=>{currentFilter=e.target.value;renderProducts()});
document.querySelector('#sort-filter').addEventListener('change',e=>{currentSort=e.target.value;renderProducts()});
document.querySelector('#cart-open').addEventListener('click',openCart);document.querySelector('#cart-close').addEventListener('click',closeCart);document.querySelector('#overlay').addEventListener('click',closeCart);
const checkoutDialog=document.querySelector('#checkout-dialog'), checkoutForm=document.querySelector('#checkout-form'), checkoutStatus=document.querySelector('#checkout-status'), quoteButton=document.querySelector('#quote-button'), payButton=document.querySelector('#pay-button');
const sandboxPreview=(location.hostname==='localhost'||location.hostname==='127.0.0.1')&&['4246','4247','4248','4249','4250','4251','4252','4253','4260','4261','4262','4263','4270','4271','4272','4273','4280','4281','4282','4283'].includes(location.port);
const sandboxNotice=document.querySelector('#sandbox-notice');
if(sandboxPreview){sandboxNotice.hidden=false;document.querySelector('#environment-label').textContent='Prévia local de teste · pagamento simulado · sem cobrança real';payButton.textContent='Criar pagamento de teste';document.querySelector('#checkout-title').textContent='Checkout em ambiente de teste';document.querySelector('#checkout-note').textContent='Esta versão usa credenciais de teste e não movimenta dinheiro real. Use uma conta compradora de teste do Mercado Pago.'}
let shippingOptions=[], selectedShipping=null;
function checkoutItems(){if(!Array.isArray(cart)||!cart.length)throw new Error('A sacola está vazia. Adicione novamente o produto antes de consultar o frete.');if(!backendCatalog.length)throw new Error('Não foi possível carregar o catálogo do Supabase. Atualize a página e tente novamente.');const items=cart.map(item=>{const p=productForCart(item),v=variantRecordFor(p,item.variant,item.variantId,item.variantSku||item.variant_sku||item.sku);return {variant_id:v?.id,quantity:Number(item.qty)}});if(items.length!==cart.length||items.some(x=>!x.variant_id||!Number.isInteger(x.quantity)||x.quantity<1))throw new Error('Um ou mais produtos não foram vinculados às variantes do catálogo. Remova somente o item sem vínculo e adicione o produto novamente.');if(!items.length)throw new Error('A sacola está vazia. Adicione novamente o produto antes de consultar o frete.');return items}
function checkoutMessage(message,type=''){checkoutStatus.textContent=message;checkoutStatus.className=`checkout-status ${type}`}
function renderShippingOptions(){const node=document.querySelector('#shipping-options');node.innerHTML=shippingOptions.map((option,index)=>`<label class="shipping-option"><span><input type="radio" name="shipping" value="${index}" ${index===0?'checked':''}><span>${escapeHTML(option.service_name)}${option.delivery_days?` · até ${option.delivery_days} dias úteis`:''}</span></span><strong>${money(option.price_cents/100)}</strong></label>`).join('');selectedShipping=shippingOptions[0]||null;payButton.disabled=!selectedShipping}
document.querySelector('#checkout-button').addEventListener('click',()=>{if(!cart.length){toast('Adicione um produto à sacola primeiro.');return}shippingOptions=[];selectedShipping=null;payButton.disabled=true;document.querySelector('#shipping-options').replaceChildren();checkoutForm.reset();checkoutMessage('Informe seus dados e o CEP para calcular as opções de entrega.');checkoutDialog.showModal()});
document.querySelector('#checkout-close').addEventListener('click',()=>checkoutDialog.close());
quoteButton.addEventListener('click',async()=>{const data=new FormData(checkoutForm),postal=String(data.get('postal_code')||'').replace(/\D/g,'');if(!/^\d{8}$/.test(postal)){checkoutMessage('Digite um CEP válido para consultar o Melhor Envio.','error');return}quoteButton.disabled=true;quoteButton.textContent='Consultando…';checkoutMessage('Consultando cotações atualizadas…');try{const cfg=window.FIO_STORE_CONFIG;const response=await fetch(`${cfg.supabaseUrl}/functions/v1/shipping-quote`,{method:'POST',headers:{apikey:cfg.supabasePublishableKey,'Content-Type':'application/json'},body:JSON.stringify({postal_code:postal,items:checkoutItems()})});const result=await response.json();if(!response.ok){const known={invalid_request:'Sacola vazia ou inválida. Remova o produto e adicione novamente.',invalid_product:'O produto da sacola não está vinculado ao catálogo do backend.',catalog_lookup_failed:'O backend não conseguiu validar o catálogo. Tente atualizar a página.',invalid_cart_or_shipping_specs:'A quantidade ou as dimensões do produto não são válidas para o frete.'};throw new Error(result.message||known[result.error]||`Falha ao consultar frete (${result.error||response.status}).`)}shippingOptions=result.options||[];if(!shippingOptions.length)throw new Error('O Melhor Envio não encontrou serviços para este CEP e os produtos escolhidos.');renderShippingOptions();checkoutMessage('Escolha uma opção de entrega e continue para pagar.','success')}catch(error){shippingOptions=[];selectedShipping=null;payButton.disabled=true;checkoutMessage(error.message||'Falha ao consultar o frete.','error')}finally{quoteButton.disabled=false;quoteButton.textContent='Consultar opções de frete'}});
document.querySelector('#shipping-options').addEventListener('change',event=>{const input=event.target.closest('input[name="shipping"]');if(input){selectedShipping=shippingOptions[Number(input.value)]||null;payButton.disabled=!selectedShipping}});
checkoutForm.addEventListener('submit',async event=>{event.preventDefault();if(!selectedShipping)return;if(!sandboxPreview){checkoutMessage('O checkout de produção continua fechado. Abra a prévia de teste pela porta 4280.','error');payButton.disabled=true;return}const data=new FormData(checkoutForm),postal=String(data.get('postal_code')||'').replace(/\D/g,'');if(!/^\d{8}$/.test(postal)){checkoutMessage('Digite um CEP válido.','error');return}payButton.disabled=true;payButton.textContent='Preparando teste…';checkoutMessage('Validando a cotação e criando um pedido de teste…');try{const cfg=window.FIO_STORE_CONFIG;const storageKey='fio-checkout-sandbox-idempotency';const idempotencyKey=sessionStorage.getItem(storageKey)||crypto.randomUUID();sessionStorage.setItem(storageKey,idempotencyKey);const response=await fetch(`${cfg.supabaseUrl}${cfg.sandboxCheckoutEndpoint}`,{method:'POST',headers:{apikey:cfg.supabasePublishableKey,'Content-Type':'application/json'},body:JSON.stringify({idempotency_key:idempotencyKey,items:checkoutItems(),shipping_quote_token:selectedShipping.quote_token,customer:{name:data.get('name'),email:data.get('email'),phone:data.get('phone')},address:{postal_code:postal,street:data.get('street'),number:data.get('number'),complement:data.get('complement'),district:data.get('district'),city:data.get('city'),state:String(data.get('state')).toUpperCase()}})});const result=await response.json();if(!response.ok){if(result.error==='mercado_pago_test_error')sessionStorage.removeItem(storageKey);throw new Error(result.message||'Não foi possível iniciar o teste de pagamento.');}const checkoutUrl=new URL(result.checkout_url);if(checkoutUrl.protocol!=='https:'||!/(^|\.)mercadopago\.(com|com\.br)$/.test(checkoutUrl.hostname))throw new Error('O Mercado Pago retornou um endereço de checkout inválido.');sessionStorage.removeItem(storageKey);checkoutMessage('Pedido de teste criado. Abrindo o Mercado Pago…','success');location.assign(checkoutUrl.href)}catch(error){checkoutMessage(error.message||'Falha ao iniciar o checkout de teste.','error');payButton.disabled=!selectedShipping}finally{payButton.textContent='Criar pagamento de teste'}});

document.querySelector('#dialog-close').addEventListener('click',()=>document.querySelector('#product-dialog').close());
document.querySelector('#search-toggle').addEventListener('click',()=>{document.querySelector('#search-drawer').classList.toggle('open');document.querySelector('#search-input').focus()});
document.querySelector('#search-submit').addEventListener('click',()=>{query=document.querySelector('#search-input').value.trim();currentFilter='all';document.querySelector('#category-filter').value='all';renderProducts();document.querySelector('#produtos').scrollIntoView()});
document.querySelector('#search-input').addEventListener('keydown',e=>{if(e.key==='Enter')document.querySelector('#search-submit').click()});
document.querySelector('#menu-toggle').addEventListener('click',()=>document.querySelector('.main-nav').classList.toggle('open'));
featuredGrid.innerHTML=featured.map(card).join('');renderProducts();renderCart();

const paymentReturn=new URLSearchParams(location.search).get('pagamento');if(paymentReturn){const messages={aprovado:'Retorno recebido. O pedido só será confirmado após validação segura do Mercado Pago.',recusado:'O pagamento não foi aprovado. Você pode tentar novamente.',pendente:'Pagamento pendente. O status será atualizado após confirmação do Mercado Pago.'};toast(messages[paymentReturn]||'Retorno do pagamento recebido.');history.replaceState({},document.title,location.pathname+location.hash)}
