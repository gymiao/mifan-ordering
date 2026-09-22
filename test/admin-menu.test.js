const test = require('node:test');
const assert = require('node:assert/strict');
const { menu, normalizeMenuItem } = require('../server');

test('管理员可以规范化有效的新菜品数据', () => {
  const item = normalizeMenuItem({
    name: '测试盖饭', description: '测试描述', price: '19.9', category: menu.categories[0].id,
    tags: ['新品', '', '热销'], available: false
  });

  assert.match(item.id, /测试盖饭/);
  assert.equal(item.price, 19.9);
  assert.deepEqual(item.tags, ['新品', '热销']);
  assert.equal(item.available, false);
});

test('管理员菜品数据拒绝未知分类和非法价格', () => {
  assert.throws(() => normalizeMenuItem({ name: '坏数据', description: 'x', price: 10, category: 'missing' }), /分类不存在/);
  assert.throws(() => normalizeMenuItem({ name: '坏数据', description: 'x', price: 0, category: menu.categories[0].id }), /名称、描述、分类和价格不能为空/);
});
