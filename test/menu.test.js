const test = require('node:test');
const assert = require('node:assert/strict');
const { menu } = require('../server');

test('菜单包含唯一商品 ID，且每个商品属于已声明分类', () => {
  const ids = menu.items.map((item) => item.id);
  const categories = new Set(menu.categories.map((category) => category.id));

  assert.equal(new Set(ids).size, ids.length);
  assert.ok(menu.items.length >= 1);
  for (const item of menu.items) {
    assert.ok(categories.has(item.category), `${item.id} 使用了未知分类`);
    assert.match(item.name, /\S+/);
    assert.ok(Number.isFinite(item.price) && item.price > 0);
    assert.equal(typeof item.available, 'boolean');
  }
});

test('餐厅配置包含有效的免配送门槛', () => {
  assert.ok(menu.restaurant.deliveryFee >= 0);
  assert.ok(menu.restaurant.freeDeliveryAt >= 0);
  assert.ok(menu.restaurant.freeDeliveryAt >= menu.restaurant.deliveryFee);
});
