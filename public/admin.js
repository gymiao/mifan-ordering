const $ = (selector) => document.querySelector(selector);
const state = { menu: null, editing: null, token: sessionStorage.getItem('mifan-admin-token') || '', focusOrder: new URLSearchParams(location.search).get('order') || '' };
const authHeaders = () => ({ Authorization: `Bearer ${state.token}`, 'Content-Type': 'application/json' });

async function api(path, options = {}) {
  const headers = { ...authHeaders(), ...(options.headers || {}) };
  if (options.body instanceof FormData) delete headers['Content-Type'];
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data;
}

async function load() {
  try { state.menu = await api('/api/menu'); render(); if (!state.token) $('#token-modal').classList.add('open'); else { $('#token-modal').classList.remove('open'); await loadOrders(); } }
  catch (error) { if (error.message.includes('身份验证') || error.message.includes('ADMIN_TOKEN')) $('#token-modal').classList.add('open'); else showToast(error.message); }
}

const statusText = { ordered: '已下单', cooking: '正在做', completed: '已完成' };
async function loadOrders() {
  const status = $('#order-status').value;
  try { const data = await api(`/api/admin/orders?status=${status}`); renderOrders(data.orders); }
  catch (error) { $('#order-list').innerHTML = `<tr><td colspan="6" class="loading">${error.message}</td></tr>`; }
}

function renderOrders(orders) {
  $('#order-count').textContent = `${orders.length} 笔订单`;
  $('#order-list').innerHTML = orders.length ? orders.map((order) => `<tr><td><strong>${order.id}</strong><small class="order-sub">${order.fulfillment === 'delivery' ? '外卖配送' : '到店自取'}${order.note ? ` · ${order.note}` : ''}</small></td><td><div class="order-dishes">${order.items.map((item) => `${item.name} × ${item.quantity}`).join('<br>')}</div></td><td><div>${order.contact || '未填写电话'}</div><small class="order-sub">${order.address || '未填写地址'}</small></td><td class="price">¥${order.total.toFixed(2)}</td><td><small>${new Date(order.createdAt).toLocaleString('zh-CN', { hour12: false })}</small></td><td><select class="order-status-select status-${order.status}" data-order-status="${order.id}">${Object.entries(statusText).map(([value, label]) => `<option value="${value}" ${value === order.status ? 'selected' : ''}>${label}</option>`).join('')}</select></td></tr>`).join('') : '<tr><td colspan="6" class="loading">暂无订单</td></tr>';
  const focus = state.focusOrder && document.querySelector(`[data-order-status="${state.focusOrder}"]`);
  if (focus) { const row = focus.closest('tr'); row.classList.add('order-focus'); requestAnimationFrame(() => row.scrollIntoView({ behavior: 'smooth', block: 'center' })); }
}

function render() {
  const query = $('#filter').value.trim().toLowerCase();
  const category = $('#category-filter').value;
  const items = state.menu.items.filter((item) => (!query || item.name.toLowerCase().includes(query)) && (category === 'all' || item.category === category));
  $('#item-count').textContent = `${items.length} 道菜品`;
  $('#item-list').innerHTML = items.length ? items.map((item) => `<tr><td><div class="dish"><span style="background:${item.color}28">${item.emoji}</span><div><strong>${item.name}</strong><small>${item.description}</small></div></div></td><td>${state.menu.categories.find((c) => c.id === item.category)?.name || item.category}</td><td class="price">¥${item.price.toFixed(2)}</td><td>${item.sales}</td><td><button class="pill ${item.available ? 'on' : ''}" data-toggle="${item.id}">${item.available ? '在售' : '已下架'}</button></td><td class="actions"><button data-edit="${item.id}">编辑</button><button data-share-dish="${item.id}">分享</button><button class="danger" data-delete="${item.id}">删除</button></td></tr>`).join('') : '<tr><td colspan="6" class="loading">没有找到菜品</td></tr>';
  $('#category-filter').innerHTML = '<option value="all">全部分类</option>' + state.menu.categories.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
  if (category !== 'all') $('#category-filter').value = category;
  $('#item-category').innerHTML = state.menu.categories.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
}

function openEditor(item) {
  state.editing = item?.id || null; $('#modal-title').textContent = item ? '编辑菜品' : '新增菜品';
  const form = $('#item-form'); form.reset();
  if (item) for (const [key, value] of Object.entries(item)) { const field = form.elements[key]; if (!field || key === 'image') continue; if (key === 'tags') field.value = value.join(','); else if (key === 'available') field.checked = value; else field.value = value; }
  form.elements.imageUrl.value = item?.image || '';
  $('#image-tip').textContent = item?.image ? '已上传图片，选择新文件可替换' : '支持 JPG、PNG、WebP，最大 8MB';
  $('#form-error').textContent = ''; $('#modal').classList.add('open'); $('#modal').setAttribute('aria-hidden', 'false');
}
function closeEditor() { $('#modal').classList.remove('open'); $('#modal').setAttribute('aria-hidden', 'true'); }
function showToast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 2200); }
async function shareLink(title, url) { try { if (navigator.share) await navigator.share({ title, url }); else { await navigator.clipboard.writeText(url); showToast('链接已复制'); } } catch (error) { if (error.name !== 'AbortError') showToast('无法复制链接'); } }

$('#token-form').addEventListener('submit', (event) => { event.preventDefault(); state.token = $('#token').value; sessionStorage.setItem('mifan-admin-token', state.token); load(); });
$('#new-item').addEventListener('click', () => openEditor()); $('#cancel').addEventListener('click', closeEditor); $('#cancel-bottom').addEventListener('click', closeEditor);
$('#filter').addEventListener('input', render); $('#category-filter').addEventListener('change', render);
$('#order-status').addEventListener('change', loadOrders);
$('#item-form').addEventListener('submit', async (event) => { event.preventDefault(); const form = new FormData(event.target); const body = Object.fromEntries(form.entries()); body.price = Number(body.price); body.tags = String(body.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean); body.available = form.has('available'); $('#save').disabled = true; try { const file = form.get('image'); let imageUrl = form.get('imageUrl') || ''; if (file && file.size) { $('#image-tip').textContent = '图片上传中…'; const uploadData = new FormData(); uploadData.append('image', file); const uploaded = await api('/api/admin/uploads', { method: 'POST', body: uploadData }); imageUrl = uploaded.url; } delete body.imageUrl; body.image = imageUrl; await api(state.editing ? `/api/admin/menu/${state.editing}` : '/api/admin/menu', { method: state.editing ? 'PUT' : 'POST', body: JSON.stringify(body) }); closeEditor(); await load(); showToast('菜单已保存'); } catch (error) { $('#form-error').textContent = error.message; } finally { $('#save').disabled = false; } });

$('#item-list').addEventListener('click', async (event) => { const edit = event.target.closest('[data-edit]'); const remove = event.target.closest('[data-delete]'); const toggle = event.target.closest('[data-toggle]'); const share = event.target.closest('[data-share-dish]'); try { if (edit) openEditor(state.menu.items.find((item) => item.id === edit.dataset.edit)); if (share) { const item = state.menu.items.find((entry) => entry.id === share.dataset.shareDish); await shareLink(item.name, `${location.origin}/?dish=${encodeURIComponent(item.id)}`); } if (remove && confirm('确认删除这道菜品吗？')) { await api(`/api/admin/menu/${remove.dataset.delete}`, { method: 'DELETE' }); await load(); showToast('菜品已删除'); } if (toggle) { const item = state.menu.items.find((entry) => entry.id === toggle.dataset.toggle); await api(`/api/admin/menu/${item.id}`, { method: 'PUT', body: JSON.stringify({ ...item, available: !item.available }) }); await load(); showToast(item.available ? '菜品已下架' : '菜品已上架'); } } catch (error) { showToast(error.message); } });
$('#order-list').addEventListener('change', async (event) => { const select = event.target.closest('[data-order-status]'); if (!select) return; try { await api(`/api/admin/orders/${select.dataset.orderStatus}/status`, { method: 'PATCH', body: JSON.stringify({ status: select.value }) }); showToast('订单状态已更新'); await loadOrders(); } catch (error) { showToast(error.message); await loadOrders(); } });
setInterval(() => { if (state.token && !document.hidden) loadOrders(); }, 10000);
load();
