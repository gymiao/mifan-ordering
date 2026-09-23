const state = {
  menu: null,
  category: 'all',
  query: '',
  cart: new Map(JSON.parse(localStorage.getItem('mifan-cart') || '[]')),
  fulfillment: 'delivery',
  sharedDish: new URLSearchParams(location.search).get('dish') || '',
  token: localStorage.getItem('mifan-customer-token') || '',
  user: null,
  pendingCheckout: false
};

const $ = (selector) => document.querySelector(selector);
const money = (value) => `¥${Number(value).toFixed(value % 1 ? 1 : 0)}`;
const authHeaders = () => state.token ? { Authorization: `Bearer ${state.token}` } : {};

function openCustomerAuth(open) {
  $('#customer-auth-modal').classList.toggle('open', open);
  $('#customer-auth-modal').setAttribute('aria-hidden', String(!open));
}
function updateCustomerAccount() {
  $('#customer-account').setAttribute('aria-label', state.user ? `已登录：${state.user.username}` : '登录');
  $('#customer-account').title = state.user ? `已登录：${state.user.username}` : '登录后点餐';
}
async function loadCustomerSession() {
  if (!state.token) return updateCustomerAccount();
  try {
    const response = await fetch('/api/auth/me', { headers: authHeaders() });
    if (!response.ok) throw new Error();
    state.user = (await response.json()).user;
  } catch { state.token = ''; localStorage.removeItem('mifan-customer-token'); }
  updateCustomerAccount();
}

async function loadMenu() {
  try {
    const response = await fetch('/api/menu');
    if (!response.ok) throw new Error('菜单加载失败');
    state.menu = await response.json();
    renderCategories();
    renderMenu();
    renderCart();
  } catch {
    $('#menu-grid').innerHTML = '<p class="no-results">菜单暂时走丢了，请刷新重试</p>';
  }
}

function renderCategories() {
  const categories = [{ id: 'all', name: '全部菜品' }, ...state.menu.categories];
  $('#categories').innerHTML = categories.map((category) =>
    `<button class="category-btn ${category.id === state.category ? 'active' : ''}" data-category="${category.id}">${category.name}</button>`
  ).join('');
}

function itemQuantity(id) { return Number(state.cart.get(id) || 0); }

function quantityControl(item) {
  const quantity = itemQuantity(item.id);
  return quantity
    ? `<div class="quantity-control"><button data-change="-1" data-id="${item.id}" aria-label="减少一份">−</button><span>${quantity}</span><button data-change="1" data-id="${item.id}" aria-label="增加一份">+</button></div>`
    : `<button class="add-btn" data-change="1" data-id="${item.id}" aria-label="添加${item.name}">+</button>`;
}

function renderMenu() {
  const query = state.query.toLowerCase();
  const items = state.menu.items.filter((item) =>
    item.available &&
    (state.category === 'all' || item.category === state.category) &&
    (!query || `${item.name}${item.description}${item.tags.join('')}`.toLowerCase().includes(query))
  );
  $('#menu-grid').innerHTML = items.length ? items.map((item) => `
    <article class="dish-card ${item.id === state.sharedDish ? 'shared-dish' : ''}" data-dish-id="${item.id}">
      <div class="dish-visual ${item.image ? 'has-image image-loading' : ''}" style="background:${item.color}28">
        ${item.tags[0] ? `<span class="badge">${item.tags[0]}</span>` : ''}
        ${item.image ? `<span class="image-loading-label">图片加载中…</span><img class="dish-image" src="${item.image}" alt="${item.name}" loading="lazy"><span class="dish-emoji image-fallback" hidden>${item.emoji}</span>` : `<span class="dish-emoji">${item.emoji}</span>`}
      </div>
      <div class="dish-info">
        <div class="dish-title-row"><h3>${item.name}</h3></div>
        <p class="dish-description">${item.description}</p>
        <div class="dish-bottom"><span class="price">${money(item.price)}</span>${quantityControl(item)}</div>
      </div>
    </article>`).join('') : '<p class="no-results">没有找到相关菜品，换个关键词试试</p>';
  document.querySelectorAll('.dish-image').forEach((image) => {
    image.addEventListener('load', () => {
      const visual = image.closest('.dish-visual');
      visual.classList.remove('image-loading');
      visual.querySelector('.image-loading-label')?.remove();
      image.classList.add('loaded');
    }, { once: true });
    image.addEventListener('error', () => {
      const visual = image.closest('.dish-visual');
      image.remove();
      visual.classList.remove('image-loading');
      const fallback = visual.querySelector('.image-fallback');
      if (fallback) fallback.hidden = false;
    }, { once: true });
  });
  const sharedCard = document.querySelector('.shared-dish');
  if (sharedCard) requestAnimationFrame(() => sharedCard.scrollIntoView({ behavior: 'smooth', block: 'center' }));
}

function cartTotals() {
  let subtotal = 0;
  let count = 0;
  if (state.menu) for (const [id, quantity] of state.cart) {
    const item = state.menu.items.find((entry) => entry.id === id);
    if (item) { subtotal += item.price * quantity; count += quantity; }
  }
  const fee = state.fulfillment === 'delivery' && subtotal > 0 && subtotal < state.menu.restaurant.freeDeliveryAt
    ? state.menu.restaurant.deliveryFee : 0;
  return { subtotal, count, fee, total: subtotal + fee };
}

function changeQuantity(id, delta) {
  const next = Math.max(0, Math.min(20, itemQuantity(id) + Number(delta)));
  if (next) state.cart.set(id, next); else state.cart.delete(id);
  localStorage.setItem('mifan-cart', JSON.stringify([...state.cart]));
  renderMenu();
  renderCart();
}

function renderCart() {
  if (!state.menu) return;
  const { subtotal, count, fee, total } = cartTotals();
  const rows = [...state.cart].map(([id, quantity]) => {
    const item = state.menu.items.find((entry) => entry.id === id);
    if (!item) return '';
    return `<div class="cart-row"><div class="cart-thumb" style="background:${item.color}22">${item.emoji}</div><div><h4>${item.name}</h4><p>${money(item.price)} × ${quantity}</p></div>${quantityControl(item)}</div>`;
  }).join('');
  $('#cart-items').innerHTML = rows;
  $('#cart-empty').hidden = count > 0;
  $('#cart-items').hidden = count === 0;
  $('#checkout-fields').hidden = count === 0;
  $('#summary').hidden = count === 0;
  $('#summary').innerHTML = `<div><span>菜品小计</span><span>${money(subtotal)}</span></div><div><span>配送费</span><span>${fee ? money(fee) : '免配送费'}</span></div><div class="total"><span>合计</span><span>${money(total)}</span></div>`;
  $('#cart-count').textContent = count;
  $('#floating-total').textContent = money(total);
  $('#checkout-total').textContent = money(total);
  $('#checkout').disabled = count === 0;
  $('#floating-cart').classList.toggle('visible', count > 0);
}

function openCart(open) {
  $('#cart-panel').classList.toggle('open', open);
  $('#cart-panel').setAttribute('aria-hidden', String(!open));
  document.body.style.overflow = open ? 'hidden' : '';
}

let toastTimer;
function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), 2200);
}

async function copyText(value) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('复制失败');
}

async function checkout() {
  if (!state.user) { state.pendingCheckout = true; openCustomerAuth(true); return; }
  const button = $('#checkout');
  button.disabled = true;
  button.firstElementChild.textContent = '正在下单…';
  try {
    const response = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        items: [...state.cart].map(([id, quantity]) => ({ id, quantity })),
        fulfillment: state.fulfillment,
        contact: '',
        address: '',
        note: $('#note').value
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '下单失败');
    state.cart.clear();
    localStorage.removeItem('mifan-cart');
    renderMenu(); renderCart(); openCart(false);
    $('#success-copy').textContent = `订单号 ${data.order.id}，预计 ${data.order.estimatedMinutes} 分钟准备完成。`;
    $('#order-share-link').value = `${location.origin}/admin.html?order=${encodeURIComponent(data.order.id)}`;
    $('#success-modal').classList.add('open');
    $('#success-modal').setAttribute('aria-hidden', 'false');
  } catch (error) {
    toast(error.message);
  } finally {
    button.firstElementChild.textContent = '确认下单';
    button.disabled = state.cart.size === 0;
  }
}

document.addEventListener('click', (event) => {
  const change = event.target.closest('[data-change]');
  if (change) changeQuantity(change.dataset.id, change.dataset.change);
  const category = event.target.closest('[data-category]');
  if (category) { state.category = category.dataset.category; renderCategories(); renderMenu(); }
  if (event.target.closest('[data-scroll-menu]')) $('#menu').scrollIntoView({ behavior: 'smooth' });
  if (event.target.closest('#floating-cart')) openCart(true);
  if (event.target.closest('[data-close-cart]')) openCart(false);
  const fulfillment = event.target.closest('[data-type]');
  if (fulfillment) {
    state.fulfillment = fulfillment.dataset.type;
    document.querySelectorAll('[data-type]').forEach((el) => el.classList.toggle('active', el === fulfillment));
    renderCart();
  }
});

$('#search').addEventListener('input', (event) => { state.query = event.target.value.trim(); renderMenu(); });
$('#checkout').addEventListener('click', checkout);
$('#success-close').addEventListener('click', () => {
  $('#success-modal').classList.remove('open');
  $('#success-modal').setAttribute('aria-hidden', 'true');
});
$('#copy-order-link').addEventListener('click', async () => {
  try { await copyText($('#order-share-link').value); toast('商家处理链接已复制'); }
  catch { $('#order-share-link').focus(); $('#order-share-link').select(); toast('请长按链接后复制'); }
});
$('#customer-account').addEventListener('click', () => { if (state.user) toast(`已登录：${state.user.username}`); else openCustomerAuth(true); });
$('#customer-auth-close').addEventListener('click', () => openCustomerAuth(false));
$('#customer-auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('#customer-auth-error').textContent = '';
  try {
    const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: $('#customer-username').value, password: $('#customer-password').value }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '登录失败');
    state.token = data.token; state.user = data.user; localStorage.setItem('mifan-customer-token', state.token); updateCustomerAccount(); openCustomerAuth(false);
    if (state.pendingCheckout) { state.pendingCheckout = false; checkout(); }
    else toast('登录成功，现在可以点餐');
  } catch (error) { $('#customer-auth-error').textContent = error.message; }
});
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') openCart(false); });

loadCustomerSession();
loadMenu();
