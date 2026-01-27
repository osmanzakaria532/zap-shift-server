const express = require('express');
const cors = require('cors');
require('dotenv').config();
// Payment Connection
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const app = express();
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

// MiddleWare
app.use(express.json());
app.use(cors());

// Firebase Admin SDK Initialization
const admin = require('firebase-admin');
const serviceAccount = require('./zap-shift-authentication-adminsdk.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.daqctd4.mongodb.net/?appName=Cluster0`;

// JWT implementation will be added here
const verifyFBToken = async (req, res, next) => {
  //   console.log('Hitting verifyFBToken', req.headers.authorization);
  const token = req.headers?.authorization;
  if (!token) {
    return res.status(401).send({ message: 'unauthorized access' });
  }
  try {
    const idToken = token.split(' ')[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    console.log('Decoded Token:', decoded);
    req.decoded_email = decoded.email;
    next();
  } catch (error) {
    return res.status(401).send({ message: 'unauthorized access' });
  }
};

// creating tracking id for parcel
const crypto = require('crypto');
const e = require('express');
function generateTrackingId() {
  const prefix = 'ZAP'; // your company short code
  const randomBytes = crypto.randomBytes(4).toString('hex').toUpperCase(); // 8 chars
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `${prefix}-${date}-${randomBytes}`;
}

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

app.get('/', (req, res) => {
  res.send('Zap Shift Server is Running!');
});

const PERMANENT_ADMIN_EMAIL = 'osmanzakaria801@gmail.com';

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    const db = client.db('zap_shift_db');
    const userCollection = db.collection('users');
    const parcelsCollection = db.collection('parcels');
    const paymentCollection = db.collection('payments');
    const ridersCollection = db.collection('riders');

    // user related apis

    app.get('/users', async (req, res) => {
      const { email } = req.query;
      const query = {};
      if (email) {
        query.email = email;
      }

      // সব user fetch
      const users = await userCollection.find(query).toArray();

      // Permanent admin কে top এ নিয়ে আসা
      const sortedUsers = users.sort((a, b) => {
        if (a.email === PERMANENT_ADMIN_EMAIL) return -1; // top
        if (b.email === PERMANENT_ADMIN_EMAIL) return 1;
        // baki gula createdAt descending
        return new Date(b.createdAt) - new Date(a.createdAt);
      });

      res.send(sortedUsers);
    });

    app.get('/users/:email/role', async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await userCollection.findOne(query);
      res.send({ role: user?.role || 'user' });
    });

    app.post('/users', async (req, res) => {
      console.log('User API hit', req.body); // 👈 add this
      const user = req.body;
      user.role = 'user';
      user.createdAt = new Date();

      // 🔒 Permanent admin force
      if (user.email === PERMANENT_ADMIN_EMAIL) {
        user.role = 'admin';
      } else {
        user.role = 'user';
      }

      const email = user.email;
      const userExists = await userCollection.findOne({ email });
      if (userExists) {
        return res.send({ message: 'user already exists' });
      }

      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    // PATCH /users/:email - update region & district if logged in via social login
    app.patch('/users/:email', async (req, res) => {
      const email = req.params.email;
      const { region, district } = req.body;

      console.log('Update Profile API hit', { email, region, district });

      // check if data provided For Login Social profile
      if (!region || !district) {
        return res.status(400).send({ error: 'Region and District are required' });
      }

      try {
        const userExists = await userCollection.findOne({ email });
        if (!userExists) {
          return res.status(404).send({ error: 'User not found' });
        }

        const result = await userCollection.updateOne({ email }, { $set: { region, district } });
        res.send({ message: 'User profile updated successfully', result });
      } catch (err) {
        console.log('Error updating user', err);
        res.status(500).send({ error: 'Server error' });
      }
    });

    app.patch('/users-role/:id', async (req, res) => {
      const id = req.params.id;
      const { roleInfo, email } = req.body; // email: currently logged-in user
      const query = { _id: new ObjectId(id) };

      // 🔒 Permanent admin cannot change
      if (email === PERMANENT_ADMIN_EMAIL) {
        return res.status(403).send({
          message: 'Permanent admin role cannot be changed',
        });
      }

      const updatedDoc = {
        $set: {
          role: roleInfo.role,
        },
      };
      const result = await userCollection.updateOne(query, updatedDoc);
      res.send(result);
    });

    app.delete('/users/:id', verifyFBToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      // 🔒 Permanent admin protection
      const userToDelete = await userCollection.findOne(query);
      if (userToDelete?.email === PERMANENT_ADMIN_EMAIL) {
        return res.status(403).send({
          message: 'This admin cannot be removed',
        });
      }

      const result = await userCollection.deleteOne(query);
      res.send(result);
    });

    // Riders related apis will be added here
    app.get('/riders', async (req, res) => {
      const query = {};
      if (req.query.status) {
        query.status = req.query.status;
      }

      const cursor = ridersCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.post('/riders', async (req, res) => {
      const rider = req.body;

      // Rider Created Time & Status
      // rider.riderEmail = req.user.email;
      rider.status = 'pending';
      rider.createdAt = new Date();

      const result = await ridersCollection.insertOne(rider);
      res.send(result);
    });

    app.patch('/riders/:id', verifyFBToken, async (req, res) => {
      const status = req.body.status;
      console.log('STATUS:', status);
      const id = req.params.id;

      // find the rider
      const query = { _id: new ObjectId(id) };
      const rider = await ridersCollection.findOne(query);
      console.log('RIDER EMAIL:', rider.email);
      if (!rider) {
        return res.status(404).send({ message: 'Rider not found' });
      }

      const updatedDoc = {
        $set: { status: status },
      };
      const result = await ridersCollection.updateOne(query, updatedDoc);

      // Approval
      if (status === 'approved') {
        const email = req.body.email;
        console.log(email);

        const userQuery = { email: email };
        const updatedUser = {
          $set: { role: 'rider' },
        };
        const userResult = await userCollection.updateOne(userQuery, updatedUser);
        console.log('USER UPDATE:', userResult);
      }

      // Rejection
      if (status === 'rejected') {
        const email = req.body.email;
        console.log(email);
        const userQuery = { email: email };
        const updatedUser = {
          $set: { role: 'user' },
        };
        const userResult = await userCollection.updateOne(userQuery, updatedUser);
        console.log('USER UPDATE:', userResult);
      }

      res.send(result);
    });

    app.delete('/riders/:id', verifyFBToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await ridersCollection.deleteOne(query);
      res.send(result);
    });

    // parcels api
    app.get('/parcels', async (req, res) => {
      const query = {};
      const { email } = req.query;
      if (email) {
        query.senderEmail = email;
      }

      const options = { sort: { createdAt: -1 } };

      const cursor = parcelsCollection.find(query, options);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get('/parcels/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await parcelsCollection.findOne(query);
      res.send(result);
    });

    app.post('/parcels', async (req, res) => {
      const parcel = req.body;

      // Parcel Created Time
      parcel.createdAt = new Date();
      const result = await parcelsCollection.insertOne(parcel);
      res.send(result);
    });

    app.delete('/parcels/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const result = await parcelsCollection.deleteOne(query);
      res.send(result);
    });

    // Payment related apis
    // ---> First api (one process)
    app.post('/create-checkout-session', async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.cost) * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: 'USD',
              unit_amount: amount,
              product_data: {
                name: paymentInfo.parcelName,
              },
            },
            quantity: 1,
          },
        ],
        customer_email: paymentInfo.senderEmail,
        mode: 'payment',
        metadata: {
          parcelId: paymentInfo.parcelId,
          parcelName: paymentInfo.parcelName,
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      });

      //   console.log(session);

      res.send({ url: session.url });
    });

    // ---> Second api ( second process )
    app.post('/payment-checkout-session', async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.cost) * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: 'USD',
              unit_amount: amount,
              product_data: {
                name: paymentInfo.parcelName,
              },
            },
            quantity: 1,
          },
        ],
        customer_email: paymentInfo.senderEmail,
        mode: 'payment',
        metadata: {
          parcelId: paymentInfo.parcelId,
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      });

      //   console.log(session);
      res.send({ url: session.url });
    });

    // check payment
    app.patch('/payment-success', async (req, res) => {
      const sessionId = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(sessionId);

      // Handle duplicate data for payment in database
      const transactionId = session.payment_intent;
      const query = { transactionId: transactionId };
      const paymentExist = await paymentCollection.findOne(query);
      if (paymentExist) {
        return res.send({
          message: 'already exists',
          transactionId,
          trackingId: paymentExist.trackingId,
        });
      }

      const trackingId = generateTrackingId();

      if (session.payment_status === 'paid') {
        const id = session.metadata.parcelId;
        const query = { _id: new ObjectId(id) };
        const update = {
          $set: {
            paymentStatus: 'paid',
            trackingId: trackingId,
          },
        };
        const result = await parcelsCollection.updateOne(query, update);

        // For Payment History Process
        const payment = {
          amount: session.amount_total / 100,
          currency: session.currency,
          customerEmail: session.customer_email,
          parcelId: session.metadata.parcelId,
          parcelName: session.metadata.parcelName,
          transactionId: session.payment_intent,
          paymentStatus: session.payment_status,
          paidAt: new Date(),
          trackingId: trackingId,
        };

        if (session.payment_status === 'paid') {
          const paymentResult = await paymentCollection.insertOne(payment);
          //   console.log(paymentResult);
          return res.send({
            success: true,
            modifyParcel: result,
            trackingId: trackingId,
            transactionId: session.payment_intent,
            paymentInfo: paymentResult,
          });
        }
      }

      res.send({ success: false });
    });

    app.get('/payments', verifyFBToken, async (req, res) => {
      const email = req.query.email;
      const query = {};

      //   console.log('headers', req.headers);
      if (email) {
        query.customerEmail = email;

        // check email address
        const decodedEmail = req.decoded_email;
        if (email !== decodedEmail) {
          return res.status(403).send({ message: 'forbidden access' });
        }
      }
      const cursor = paymentCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.delete('/payments/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await paymentCollection.deleteOne(query);
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db('admin').command({ ping: 1 });
    console.log('Pinged your deployment. You successfully connected to MongoDB!');
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);
app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
