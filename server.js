const express = require('express');
const cors = require('cors');
const path = require('path');
const { connectDB, MenuItem, Order, Config, getNextOrderNumber, defaultMenu } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── In-Memory Fallback (when no MongoDB) ─────────────────────────
let useDB = false;
let memMenu = [...defaultMenu.map((item, i) => ({ ...item, id: String(i + 1) }))];
let memOrders = [];
let memOrderCounter = 100;
let memConfig = { name: 'The Spice Garden', tagline: 'Authentic flavors, modern experience', tables: 20, cashierPhone: '' };
let sseClients = [];

// ─── Utility ──────────────────────────────────────────────────────
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
}

function broadcastSSE(event, data) {
  sseClients.forEach(client => {
    client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  });
}

// ─── SSE Endpoint (Kitchen Real-Time) ─────────────────────────────
app.get('/api/orders/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const heartbeat = setInterval(() => {
    res.write(':heartbeat\n\n');
  }, 30000);

  sseClients.push(res);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients = sseClients.filter(c => c !== res);
  });
});

// ─── Config Endpoints ─────────────────────────────────────────────
app.get('/api/config', async (req, res) => {
  try {
    if (useDB) {
      const config = await Config.findOne().lean();
      res.json(config || memConfig);
    } else {
      res.json(memConfig);
    }
  } catch (e) {
    res.json(memConfig);
  }
});

app.put('/api/config', async (req, res) => {
  try {
    if (useDB) {
      const config = await Config.findOneAndUpdate({}, req.body, { new: true, upsert: true }).lean();
      res.json(config);
    } else {
      memConfig = { ...memConfig, ...req.body };
      res.json(memConfig);
    }
  } catch (e) {
    memConfig = { ...memConfig, ...req.body };
    res.json(memConfig);
  }
});

// ─── Menu Endpoints ───────────────────────────────────────────────
app.get('/api/menu', async (req, res) => {
  try {
    if (useDB) {
      const items = await MenuItem.find({ available: true }).lean();
      // Map _id to id for frontend compatibility
      res.json(items.map(i => ({ ...i, id: i._id.toString() })));
    } else {
      res.json(memMenu.filter(item => item.available));
    }
  } catch (e) {
    res.json(memMenu.filter(item => item.available));
  }
});

app.get('/api/menu/all', async (req, res) => {
  try {
    if (useDB) {
      const items = await MenuItem.find({}).lean();
      res.json(items.map(i => ({ ...i, id: i._id.toString() })));
    } else {
      res.json(memMenu);
    }
  } catch (e) {
    res.json(memMenu);
  }
});

app.post('/api/menu', async (req, res) => {
  try {
    const data = {
      name: req.body.name,
      description: req.body.description || '',
      price: Number(req.body.price),
      category: req.body.category || 'Uncategorized',
      image: req.body.image || '🍽',
      available: req.body.available !== false
    };

    if (useDB) {
      const item = await MenuItem.create(data);
      const obj = item.toObject();
      res.status(201).json({ ...obj, id: obj._id.toString() });
    } else {
      const item = { ...data, id: generateId() };
      memMenu.push(item);
      res.status(201).json(item);
    }
  } catch (e) {
    res.status(500).json({ error: 'Failed to create item' });
  }
});

app.put('/api/menu/:id', async (req, res) => {
  try {
    if (req.body.price) req.body.price = Number(req.body.price);

    if (useDB) {
      const item = await MenuItem.findByIdAndUpdate(req.params.id, req.body, { new: true }).lean();
      if (!item) return res.status(404).json({ error: 'Item not found' });
      res.json({ ...item, id: item._id.toString() });
    } else {
      const index = memMenu.findIndex(i => i.id === req.params.id);
      if (index === -1) return res.status(404).json({ error: 'Item not found' });
      memMenu[index] = { ...memMenu[index], ...req.body };
      res.json(memMenu[index]);
    }
  } catch (e) {
    res.status(500).json({ error: 'Failed to update item' });
  }
});

app.delete('/api/menu/:id', async (req, res) => {
  try {
    if (useDB) {
      const result = await MenuItem.findByIdAndDelete(req.params.id);
      if (!result) return res.status(404).json({ error: 'Item not found' });
    } else {
      const len = memMenu.length;
      memMenu = memMenu.filter(i => i.id !== req.params.id);
      if (memMenu.length === len) return res.status(404).json({ error: 'Item not found' });
    }
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete item' });
  }
});

// ─── Order Endpoints ──────────────────────────────────────────────
app.post('/api/orders', async (req, res) => {
  if (!req.body.items || req.body.items.length === 0) {
    return res.status(400).json({ error: 'Order must have at least one item' });
  }

  try {
    const total = req.body.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    if (useDB) {
      const orderNumber = await getNextOrderNumber();
      const order = await Order.create({
        orderNumber,
        tableNumber: req.body.tableNumber || 0,
        items: req.body.items,
        total,
        status: 'new'
      });
      const obj = order.toObject();
      obj.id = obj._id.toString();
      broadcastSSE('new-order', obj);
      res.status(201).json(obj);
    } else {
      const order = {
        id: generateId(),
        orderNumber: ++memOrderCounter,
        tableNumber: req.body.tableNumber || 0,
        items: req.body.items,
        total,
        status: 'new',
        createdAt: new Date().toISOString()
      };
      memOrders.unshift(order);
      broadcastSSE('new-order', order);
      res.status(201).json(order);
    }
  } catch (e) {
    res.status(500).json({ error: 'Failed to create order' });
  }
});

app.get('/api/orders', async (req, res) => {
  try {
    if (useDB) {
      const query = req.query.status ? { status: req.query.status } : {};
      const orders = await Order.find(query).sort({ createdAt: -1 }).lean();
      res.json(orders.map(o => ({ ...o, id: o._id.toString() })));
    } else {
      const { status } = req.query;
      if (status) return res.json(memOrders.filter(o => o.status === status));
      res.json(memOrders);
    }
  } catch (e) {
    res.json([]);
  }
});

app.get('/api/orders/:id', async (req, res) => {
  try {
    if (useDB) {
      const order = await Order.findById(req.params.id).lean();
      if (!order) return res.status(404).json({ error: 'Order not found' });
      res.json({ ...order, id: order._id.toString() });
    } else {
      const order = memOrders.find(o => o.id === req.params.id);
      if (!order) return res.status(404).json({ error: 'Order not found' });
      res.json(order);
    }
  } catch (e) {
    res.status(404).json({ error: 'Order not found' });
  }
});

app.patch('/api/orders/:id/status', async (req, res) => {
  const validTransitions = {
    'new': ['preparing', 'cancelled'],
    'preparing': ['ready', 'cancelled'],
    'ready': ['completed'],
    'completed': [],
    'cancelled': []
  };

  try {
    if (useDB) {
      const order = await Order.findById(req.params.id);
      if (!order) return res.status(404).json({ error: 'Order not found' });

      const allowed = validTransitions[order.status] || [];
      if (!allowed.includes(req.body.status)) {
        return res.status(400).json({ error: `Cannot move from '${order.status}' to '${req.body.status}'` });
      }

      order.status = req.body.status;
      await order.save();
      const obj = order.toObject();
      obj.id = obj._id.toString();
      broadcastSSE('order-updated', obj);
      res.json(obj);
    } else {
      const order = memOrders.find(o => o.id === req.params.id);
      if (!order) return res.status(404).json({ error: 'Order not found' });

      const allowed = validTransitions[order.status] || [];
      if (!allowed.includes(req.body.status)) {
        return res.status(400).json({ error: `Cannot move from '${order.status}' to '${req.body.status}'` });
      }

      order.status = req.body.status;
      order.updatedAt = new Date().toISOString();
      broadcastSSE('order-updated', order);
      res.json(order);
    }
  } catch (e) {
    res.status(500).json({ error: 'Failed to update order' });
  }
});

// ─── Stats Endpoint ───────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
  try {
    if (useDB) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const todaysOrders = await Order.find({ createdAt: { $gte: today } }).lean();
      const allActive = await Order.find({ status: { $in: ['new', 'preparing', 'ready'] } }).countDocuments();
      const menuCount = await MenuItem.countDocuments();
      const categories = await MenuItem.distinct('category');

      res.json({
        totalOrders: todaysOrders.length,
        activeOrders: allActive,
        completedToday: todaysOrders.filter(o => o.status === 'completed').length,
        todaysRevenue: todaysOrders.filter(o => o.status !== 'cancelled').reduce((sum, o) => sum + o.total, 0),
        menuItems: menuCount,
        categories: categories.length
      });
    } else {
      const today = new Date().toDateString();
      const todaysOrders = memOrders.filter(o => new Date(o.createdAt).toDateString() === today);
      res.json({
        totalOrders: todaysOrders.length,
        activeOrders: memOrders.filter(o => ['new', 'preparing', 'ready'].includes(o.status)).length,
        completedToday: todaysOrders.filter(o => o.status === 'completed').length,
        todaysRevenue: todaysOrders.filter(o => o.status !== 'cancelled').reduce((sum, o) => sum + o.total, 0),
        menuItems: memMenu.length,
        categories: [...new Set(memMenu.map(i => i.category))].length
      });
    }
  } catch (e) {
    res.json({ totalOrders: 0, activeOrders: 0, completedToday: 0, todaysRevenue: 0, menuItems: 0, categories: 0 });
  }
});

// ─── Serve Pages ──────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/kitchen', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'kitchen.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/manage', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'manage.html'));
});

app.get('/admin-login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-login.html'));
});

// ─── Start Server ─────────────────────────────────────────────────
async function start() {
  // Try connecting to MongoDB
  useDB = await connectDB();

  app.listen(PORT, () => {
    console.log('');
    console.log('  DineFlow is running!');
    console.log('  -----------------------------------');
    console.log(`  Customer Menu:    http://localhost:${PORT}`);
    console.log(`  Admin Dashboard:  http://localhost:${PORT}/admin`);
    console.log(`  Menu Toggle:      http://localhost:${PORT}/manage`);
    console.log('  -----------------------------------');
    console.log(`  Database: ${useDB ? 'MongoDB (persistent)' : 'In-memory (will reset on restart)'}`);
    console.log('');
  });
}

start();
