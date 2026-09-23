const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateOrder, menu } = require('../server');

const firstItem = menu.items[0];

test('后端按菜单价格重算订单，并合并重复商品', () => {
  const order = calculateOrder({
    fulfillment: 'delivery',
    contact: '13800000000',
    address: '上海市黄浦区示例路 1 号',
    items: [
      { id: firstItem.id, quantity: 1, price: 0.01 },
      { id: firstItem.id, quantity: 2, price: 999999 }
    ]
  });

  assert.equal(order.items.length, 1);
  assert.equal(order.items[0].quantity, 3);
  assert.equal(order.items[0].price, firstItem.price);
  assert.equal(order.subtotal, firstItem.price * 3);
  assert.equal(order.total, order.subtotal + order.deliveryFee);
});

test('达到免配送门槛后配送费为零', () => {
  const item = menu.items.find((entry) => entry.price >= menu.restaurant.freeDeliveryAt);
  const order = item
    ? calculateOrder({ fulfillment: 'delivery', contact: '13800000000', address: '地址', items: [{ id: item.id, quantity: 1 }] })
    : calculateOrder({ fulfillment: 'delivery', contact: '13800000000', address: '地址', items: [{ id: firstItem.id, quantity: 20 }] });

  if (order.subtotal >= menu.restaurant.freeDeliveryAt) assert.equal(order.deliveryFee, 0);
});

test('电话和地址均可选，自取订单不收配送费', () => {
  const order = calculateOrder({
    fulfillment: 'pickup',
    items: [{ id: firstItem.id, quantity: 1 }]
  });

  assert.equal(order.deliveryFee, 0);
  assert.equal(order.estimatedMinutes, 20);
  assert.equal(order.contact, '');
  assert.equal(order.address, '');
});

test('后端拒绝未知商品和非法数量', () => {
  assert.throws(() => calculateOrder({ fulfillment: 'delivery', contact: '1', address: '地址', items: [{ id: 'missing', quantity: 1 }] }), /商品或数量无效/);
  assert.throws(() => calculateOrder({ fulfillment: 'delivery', contact: '1', address: '地址', items: [{ id: firstItem.id, quantity: 0 }] }), /商品或数量无效/);
});
